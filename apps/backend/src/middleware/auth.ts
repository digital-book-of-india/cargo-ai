import { Request, Response, NextFunction, RequestHandler } from "express";
import { Types } from "mongoose";
import { CompanyRole } from "@dbi/api-types";
import { verifyAccessToken } from "../utils/auth";
import { CameraModel, CompanyMemberModel, CompanyModel, SiteModel, UserModel } from "../models";
import { AppError } from "./errorHandler";
import { Permission, can, canAccessSite } from "../services/authz/permissions";

// Express 4 does not catch rejected promises; this forwards them to the error handler.
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}

// The company panel and the platform-admin panel each have their own cookie. Cookies belong to a host, not a port,
// so with one shared name, signing in on one panel replaced the other panel's session. Company routes read
// ACCESS_COOKIE, /api/v1/admin routes read ADMIN_COOKIE.
export const ACCESS_COOKIE = "cargosense_token";
export const ADMIN_COOKIE = "cargosense_admin";

// Where the access token comes from: a Bearer header (API clients, tests) or the httpOnly cookie (the panels).
export function readAccessToken(req: Request, cookieName: string = ACCESS_COOKIE): string | undefined {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) return authHeader.substring(7);
  if (req.headers.cookie) {
    const cookies = Object.fromEntries(
      req.headers.cookie.split(";").map((c) => {
        const [k, ...v] = c.trim().split("=");
        return [k, v.join("=")];
      })
    );
    return cookies[cookieName];
  }
  return undefined;
}

export type SessionResult =
  | { ok: true; user: { id: string; email: string; role: string; status: string; name: string } }
  | { ok: false; status: number; code: string; message: string };

// A token is only the start: the account is read from the database on every request. So a suspended user, a user
// whose role was taken away, and a token that was signed out (its version is old) stop working at once, not in a week.
export async function verifySession(token: string | undefined): Promise<SessionResult> {
  if (!token) return { ok: false, status: 401, code: "UNAUTHORIZED", message: "Authentication token missing." };
  const payload = verifyAccessToken(token);
  if (!payload) return { ok: false, status: 401, code: "UNAUTHORIZED", message: "Invalid or expired token." };

  const user = Types.ObjectId.isValid(payload.id)
    ? await UserModel.findById(payload.id).select("email name role status tokenVersion").lean()
    : null;
  if (!user) return { ok: false, status: 401, code: "UNAUTHORIZED", message: "Invalid or expired token." };
  if ((payload.tv ?? 0) !== (user.tokenVersion ?? 0)) {
    return { ok: false, status: 401, code: "UNAUTHORIZED", message: "This session has ended. Please sign in again." };
  }
  if (user.status === "SUSPENDED") {
    return { ok: false, status: 403, code: "ACCOUNT_SUSPENDED", message: "This account has been suspended. Please contact support." };
  }
  return { ok: true, user: { id: user._id.toString(), email: user.email, role: user.role, status: user.status, name: user.name } };
}

export const authenticate = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const session = await verifySession(readAccessToken(req));
  if (!session.ok) {
    res.status(session.status).json({ error: { code: session.code, message: session.message, requestId: req.requestId } });
    return;
  }
  req.user = session.user;
  next();
});

export function requirePlatformAdmin(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) return next(new AppError(401, "UNAUTHORIZED", "Authentication required."));
  if (req.user.role !== "PLATFORM_ADMIN") {
    return next(new AppError(403, "FORBIDDEN", "You do not have permission to access this resource."));
  }
  next();
}

// Works out which company this request acts in. The company is derived from the signed-in
// user's memberships, never from the request body. The optional X-Company-Id header can only
// choose between companies the user actually belongs to.
export const resolveTenant = asyncHandler(async (req, _res, next) => {
  if (!req.user) throw new AppError(401, "UNAUTHORIZED", "Authentication required.");

  const user = await UserModel.findById(req.user.id).select("status").lean();
  if (!user) throw new AppError(401, "UNAUTHORIZED", "Account not found.");
  if (user.status === "SUSPENDED") {
    throw new AppError(403, "ACCOUNT_SUSPENDED", "This account has been suspended. Please contact support.");
  }

  const memberships = await CompanyMemberModel.find({ userId: req.user.id, status: "ACTIVE" })
    .sort({ createdAt: 1 })
    .lean();
  if (memberships.length === 0) {
    throw new AppError(403, "NO_COMPANY", "You are not a member of any company.");
  }

  const companies = await CompanyModel.find({
    _id: { $in: memberships.map((m) => m.companyId) },
    status: "ACTIVE",
  })
    .select("_id")
    .lean();
  const activeCompanyIds = new Set(companies.map((c) => c._id.toString()));
  const usable = memberships.filter((m) => activeCompanyIds.has(m.companyId.toString()));
  if (usable.length === 0) {
    throw new AppError(403, "COMPANY_SUSPENDED", "Your company is not active. Please contact support.");
  }

  const requested = req.headers["x-company-id"];
  const requestedId = Array.isArray(requested) ? requested[0] : requested;
  const chosen = requestedId ? usable.find((m) => m.companyId.toString() === requestedId) : usable[0];
  if (!chosen) {
    throw new AppError(403, "FORBIDDEN", "You do not have access to that company.");
  }

  req.tenant = {
    companyId: chosen.companyId.toString(),
    role: chosen.role as CompanyRole,
    siteIds: (chosen.siteIds ?? []).map((id) => id.toString()),
    memberId: chosen._id.toString(),
  };
  next();
});

export function requirePermission(permission: Permission): RequestHandler {
  return (req, _res, next) => {
    if (!req.tenant) return next(new AppError(401, "UNAUTHORIZED", "Authentication required."));
    if (!can(req.tenant.role, permission)) {
      return next(new AppError(403, "FORBIDDEN", "You do not have permission to do this."));
    }
    next();
  };
}

// authenticate + resolve company + check one permission.
export function guard(permission: Permission): RequestHandler[] {
  return [authenticate, resolveTenant, requirePermission(permission)];
}

function parseId(value: string | undefined): Types.ObjectId | null {
  if (!value || !Types.ObjectId.isValid(value)) return null;
  return new Types.ObjectId(value);
}

// Loads :siteId inside the caller's company. A site of another company looks exactly like a
// missing one (404) so IDs of other tenants are never confirmed.
export function requireSiteAccess(permission: Permission): RequestHandler[] {
  const load = asyncHandler(async (req, _res, next) => {
    const id = parseId(req.params.siteId);
    const site = id ? await SiteModel.findOne({ _id: id, companyId: req.tenant!.companyId }) : null;
    if (!site || !canAccessSite(req.tenant!.role, req.tenant!.siteIds, site._id.toString())) {
      throw new AppError(404, "NOT_FOUND", "Site not found.");
    }
    req.site = site;
    next();
  });
  return [authenticate, resolveTenant, requirePermission(permission), load];
}

// Loads :cameraId inside the caller's company and checks the caller may use its site.
export function requireCameraAccess(permission: Permission): RequestHandler[] {
  const load = asyncHandler(async (req, _res, next) => {
    const id = parseId(req.params.cameraId);
    const camera = id ? await CameraModel.findOne({ _id: id, companyId: req.tenant!.companyId }) : null;
    if (!camera || !canAccessSite(req.tenant!.role, req.tenant!.siteIds, camera.siteId.toString())) {
      throw new AppError(404, "NOT_FOUND", "Camera not found.");
    }
    req.camera = camera;
    next();
  });
  return [authenticate, resolveTenant, requirePermission(permission), load];
}
