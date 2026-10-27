import { Router, Request, Response, CookieOptions } from "express";
import { Types } from "mongoose";
import { registerSchema, loginSchema, updateProfileSchema, acceptInvitationSchema } from "@dbi/validation";
import { CompanyMemberModel, CompanyModel, InvitationModel, UserModel } from "../../models";
import { env } from "../../config/env";
import { isDuplicateKeyError } from "../../utils/validation";
import { DUMMY_PASSWORD_HASH, hashPassword, comparePassword, signAccessToken, ttlToMs, verifyAccessToken } from "../../utils/auth";
import { ACCESS_COOKIE, ADMIN_COOKIE, asyncHandler, authenticate, readAccessToken } from "../../middleware/auth";
import { authRateLimiter } from "../../middleware/rateLimiter";
import { AppError } from "../../middleware/errorHandler";
import { logAuditEvent } from "../../services/audit/logger";
import { formatUser, hashInvitationToken, loadMemberships } from "../../services/tenancy/memberships";

export const authRouter = Router();

const COOKIE_OPTIONS: CookieOptions = {
  httpOnly: true,
  secure: env.isProduction,
  sameSite: "lax",
  maxAge: ttlToMs(env.accessTokenTtl), // the same lifetime as the token inside it
};

// Wrong passwords in a row before the account is locked, and for how long. A lock is per account, because an IP limit
// alone cannot stop someone who spreads guesses over many addresses.
const MAX_FAILED_LOGINS = 5;
const LOCK_MS = 15 * 60_000;

function issueSession(
  res: Response,
  user: { _id: any; email: string; role: any; tokenVersion?: number },
  cookieName: string = ACCESS_COOKIE
): string {
  const token = signAccessToken({ id: user._id.toString(), email: user.email, role: user.role, tv: user.tokenVersion ?? 0 });
  res.cookie(cookieName, token, COOKIE_OPTIONS);
  return token;
}

function validationError(message: string | undefined, fallback: string): AppError {
  return new AppError(400, "VALIDATION_ERROR", message ?? fallback);
}

// POST /api/v1/auth/register
// Self-signup creates the user, a new company and an owner membership.
authRouter.post(
  "/register",
  authRateLimiter,
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) throw validationError(parsed.error.issues[0]?.message, "Invalid registration data");

    const { name, email, password, companyName } = parsed.data;
    const existing = await UserModel.findOne({ email: email.toLowerCase() });
    if (existing) throw new AppError(409, "CONFLICT", "An account with this email already exists.");

    const passwordHash = await hashPassword(password);
    let user;
    try {
      user = await UserModel.create({
        name,
        email: email.toLowerCase(),
        passwordHash,
        role: "USER",
        status: "ACTIVE",
      });
    } catch (err) {
      // someone registered the same email between the check above and now
      if (isDuplicateKeyError(err)) throw new AppError(409, "CONFLICT", "An account with this email already exists.");
      throw err;
    }

    let company;
    try {
      company = await CompanyModel.create({
        name: companyName ?? `${name}'s company`,
        createdBy: user._id,
      });
      await CompanyMemberModel.create({
        companyId: company._id,
        userId: user._id,
        role: "COMPANY_OWNER",
        status: "ACTIVE",
        siteIds: [],
      });
    } catch (err) {
      // Standalone MongoDB has no multi-document transactions: undo what was created.
      if (company) await CompanyModel.deleteOne({ _id: company._id }).catch(() => undefined);
      await UserModel.deleteOne({ _id: user._id }).catch(() => undefined);
      throw err;
    }

    await logAuditEvent({
      actorUserId: user._id.toString(),
      companyId: company._id.toString(),
      action: "COMPANY_REGISTERED",
      targetType: "Company",
      targetId: company._id.toString(),
      requestId: req.requestId,
    });

    const token = issueSession(res, user);
    res.status(201).json({
      data: { user: formatUser(user), memberships: await loadMemberships(user._id.toString()), token },
    });
  })
);

// POST /api/v1/auth/login
authRouter.post(
  "/login",
  authRateLimiter,
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) throw validationError(parsed.error.issues[0]?.message, "Invalid login data");

    const { email, password } = parsed.data;
    const user = await UserModel.findOne({ email: email.toLowerCase() });

    // A locked account answers before any password is compared, so guessing during the lock learns nothing.
    if (user?.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      throw new AppError(429, "RATE_LIMITED", "Too many failed sign-in attempts. Try again in a few minutes.");
    }

    // The password is always compared (against a dummy hash for an unknown email), so the answer takes the same time
    // whether or not the account exists, and nothing about the account is revealed before the password is right.
    const isMatch = await comparePassword(password, user?.passwordHash ?? DUMMY_PASSWORD_HASH);
    if (!user || !isMatch) {
      if (user) {
        const failed = (user.failedLogins ?? 0) + 1;
        await UserModel.updateOne(
          { _id: user._id },
          failed >= MAX_FAILED_LOGINS
            ? { $set: { failedLogins: 0, lockedUntil: new Date(Date.now() + LOCK_MS) } }
            : { $set: { failedLogins: failed } }
        );
      }
      throw new AppError(401, "UNAUTHORIZED", "Invalid email or password.");
    }

    if (user.status === "SUSPENDED") {
      throw new AppError(403, "ACCOUNT_SUSPENDED", "This account has been suspended. Please contact support.");
    }
    if ((user.failedLogins ?? 0) > 0 || user.lockedUntil) {
      await UserModel.updateOne({ _id: user._id }, { $set: { failedLogins: 0, lockedUntil: null } });
    }

    // The platform-admin panel signs in with panel: "admin": platform administrators only, a cookie of its own, and no
    // token in the answer (the panel keeps nothing in the browser that a script could read).
    if (parsed.data.panel === "admin") {
      if (user.role !== "PLATFORM_ADMIN") {
        throw new AppError(403, "FORBIDDEN", "This account is not a platform administrator.");
      }
      issueSession(res, user, ADMIN_COOKIE);
      res.json({ data: { user: formatUser(user), memberships: [] } });
      return;
    }

    const token = issueSession(res, user);
    res.json({
      data: { user: formatUser(user), memberships: await loadMemberships(user._id.toString()), token },
    });
  })
);

// POST /api/v1/auth/logout
// Signing out ends every sign-in of this user (the token version is raised), not only this browser's cookie: a token that
// was copied before sign-out stops working too.
authRouter.post(
  "/logout",
  asyncHandler(async (req: Request, res: Response) => {
    const cookieName = req.body?.panel === "admin" ? ADMIN_COOKIE : ACCESS_COOKIE;
    const payload = verifyAccessToken(readAccessToken(req, cookieName) ?? "");
    if (payload && Types.ObjectId.isValid(payload.id)) {
      await UserModel.updateOne({ _id: payload.id, tokenVersion: payload.tv ?? 0 }, { $inc: { tokenVersion: 1 } });
    }
    res.clearCookie(cookieName);
    res.json({ data: { message: "Logged out successfully" } });
  })
);

// POST /api/v1/auth/accept-invitation  (public: the one-time token is the credential)
authRouter.post(
  "/accept-invitation",
  authRateLimiter,
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = acceptInvitationSchema.safeParse(req.body);
    if (!parsed.success) throw validationError(parsed.error.issues[0]?.message, "Invalid invitation data");

    const { token, name, password } = parsed.data;
    const invitation = await InvitationModel.findOne({ tokenHash: hashInvitationToken(token) });
    // One generic message for unknown, used, revoked and expired tokens.
    const invalid = new AppError(400, "INVALID_INVITATION", "This invitation is invalid or has expired.");
    if (!invitation || invitation.status !== "PENDING" || invitation.expiresAt.getTime() < Date.now()) {
      throw invalid;
    }

    const company = await CompanyModel.findOne({ _id: invitation.companyId, status: "ACTIVE" });
    if (!company) throw invalid;

    let user = await UserModel.findOne({ email: invitation.email });
    if (user) {
      // Existing account: the password must match, so a token alone cannot take over an account.
      if (!(await comparePassword(password, user.passwordHash))) {
        throw new AppError(401, "UNAUTHORIZED", "Invalid email or password.");
      }
      if (user.status === "SUSPENDED") {
        throw new AppError(403, "ACCOUNT_SUSPENDED", "This account has been suspended. Please contact support.");
      }
    } else {
      user = await UserModel.create({
        name,
        email: invitation.email,
        passwordHash: await hashPassword(password),
        role: "USER",
        status: "ACTIVE",
      });
    }

    // Claim the invitation atomically so a token cannot be used twice.
    const claimed = await InvitationModel.findOneAndUpdate(
      { _id: invitation._id, status: "PENDING" },
      { status: "ACCEPTED", acceptedAt: new Date() }
    );
    if (!claimed) throw invalid;

    await CompanyMemberModel.findOneAndUpdate(
      { companyId: invitation.companyId, userId: user._id },
      { role: invitation.role, status: "ACTIVE", siteIds: invitation.siteIds },
      { upsert: true, new: true }
    );

    await logAuditEvent({
      actorUserId: user._id.toString(),
      companyId: invitation.companyId.toString(),
      action: "INVITATION_ACCEPTED",
      targetType: "User",
      targetId: user._id.toString(),
      requestId: req.requestId,
      metadata: { role: invitation.role },
    });

    const session = issueSession(res, user);
    res.status(201).json({
      data: { user: formatUser(user), memberships: await loadMemberships(user._id.toString()), token: session },
    });
  })
);

// GET /api/v1/auth/me  (also served at GET /api/v1/me)
const getMe = asyncHandler(async (req: Request, res: Response) => {
  const user = await UserModel.findById(req.user!.id);
  if (!user) throw new AppError(404, "NOT_FOUND", "User not found.");
  const memberships = await loadMemberships(user._id.toString());
  res.json({
    data: {
      user: formatUser(user),
      memberships,
      activeCompanyId: memberships[0]?.companyId ?? null,
    },
  });
});
authRouter.get("/me", authenticate, getMe);

// GET /api/v1/me
export const meRouter = Router();
meRouter.get("/", authenticate, getMe);

// PATCH /api/v1/auth/me
authRouter.patch(
  "/me",
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = updateProfileSchema.safeParse(req.body);
    if (!parsed.success) throw validationError(parsed.error.issues[0]?.message, "Invalid profile data");

    const user = await UserModel.findById(req.user!.id);
    if (!user) throw new AppError(404, "NOT_FOUND", "User not found.");

    if (parsed.data.name) {
      user.name = parsed.data.name;
      await user.save();
    }

    res.json({ data: { user: formatUser(user) } });
  })
);
