import { Router, Request, Response, CookieOptions } from "express";
import { registerSchema, loginSchema, updateProfileSchema, acceptInvitationSchema } from "@dbi/validation";
import { CompanyMemberModel, CompanyModel, InvitationModel, UserModel } from "../../models";
import { hashPassword, comparePassword, signAccessToken } from "../../utils/auth";
import { asyncHandler, authenticate } from "../../middleware/auth";
import { authRateLimiter } from "../../middleware/rateLimiter";
import { AppError } from "../../middleware/errorHandler";
import { logAuditEvent } from "../../services/audit/logger";
import { formatUser, hashInvitationToken, loadMemberships } from "../../services/tenancy/memberships";

export const authRouter = Router();

const COOKIE_OPTIONS: CookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

function issueSession(res: Response, user: { _id: any; email: string; role: any }): string {
  const token = signAccessToken({ id: user._id.toString(), email: user.email, role: user.role });
  res.cookie("dbi_token", token, COOKIE_OPTIONS);
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
    if (!parsed.success) throw validationError(parsed.error.errors[0]?.message, "Invalid registration data");

    const { name, email, password, companyName } = parsed.data;
    const existing = await UserModel.findOne({ email: email.toLowerCase() });
    if (existing) throw new AppError(409, "CONFLICT", "An account with this email already exists.");

    const passwordHash = await hashPassword(password);
    const user = await UserModel.create({
      name,
      email: email.toLowerCase(),
      passwordHash,
      role: "USER",
      status: "ACTIVE",
    });

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
    if (!parsed.success) throw validationError(parsed.error.errors[0]?.message, "Invalid login data");

    const { email, password } = parsed.data;
    const user = await UserModel.findOne({ email: email.toLowerCase() });
    if (!user) throw new AppError(401, "UNAUTHORIZED", "Invalid email or password.");

    if (user.status === "SUSPENDED") {
      throw new AppError(403, "ACCOUNT_SUSPENDED", "This account has been suspended. Please contact support.");
    }

    const isMatch = await comparePassword(password, user.passwordHash);
    if (!isMatch) throw new AppError(401, "UNAUTHORIZED", "Invalid email or password.");

    const token = issueSession(res, user);
    res.json({
      data: { user: formatUser(user), memberships: await loadMemberships(user._id.toString()), token },
    });
  })
);

// POST /api/v1/auth/logout
authRouter.post("/logout", (_req: Request, res: Response) => {
  res.clearCookie("dbi_token");
  res.json({ data: { message: "Logged out successfully" } });
});

// POST /api/v1/auth/accept-invitation  (public: the one-time token is the credential)
authRouter.post(
  "/accept-invitation",
  authRateLimiter,
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = acceptInvitationSchema.safeParse(req.body);
    if (!parsed.success) throw validationError(parsed.error.errors[0]?.message, "Invalid invitation data");

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
    if (!parsed.success) throw validationError(parsed.error.errors[0]?.message, "Invalid profile data");

    const user = await UserModel.findById(req.user!.id);
    if (!user) throw new AppError(404, "NOT_FOUND", "User not found.");

    if (parsed.data.name) {
      user.name = parsed.data.name;
      await user.save();
    }

    res.json({ data: { user: formatUser(user) } });
  })
);
