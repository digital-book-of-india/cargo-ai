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

export function authenticate(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  let token: string | undefined;

  if (authHeader && authHeader.startsWith("Bearer ")) {
    token = authHeader.substring(7);
  } else if (req.headers.cookie) {
    const cookies = Object.fromEntries(
      req.headers.cookie.split(";").map((c) => {
        const [k, ...v] = c.trim().split("=");
        return [k, v.join("=")];
      })
    );
    token = cookies["dbi_token"];
  }

  if (!token) {
    res.status(401).json({
      error: {
        code: "UNAUTHORIZED",
        message: "Authentication token missing.",
        requestId: req.requestId,
      },
    });
    return;
  }

  const payload = verifyAccessToken(token);
  if (!payload) {
    res.status(401).json({
      error: {
        code: "UNAUTHORIZED",
        message: "Invalid or expired token.",
        requestId: req.requestId,
      },
    });
    return;
  }

  req.user = payload;
  next();
}

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
