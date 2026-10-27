import { Router, Request, Response } from "express";
import { Types } from "mongoose";
import { changeMemberRoleSchema, changeMemberStatusSchema, inviteUserSchema } from "@dbi/validation";
import { CompanyMemberModel, InvitationModel, UserModel } from "../../models";
import { asyncHandler, guard } from "../../middleware/auth";
import { AppError } from "../../middleware/errorHandler";
import { auditFromRequest } from "../../services/audit/logger";
import { canGrantRole, canManageMember } from "../../services/authz/permissions";
import { newInvitationToken } from "../../services/tenancy/memberships";
import { resolveCompanySiteIds } from "../../utils/validation";

export const usersRouter = Router();

const INVITATION_TTL_DAYS = 7;

function formatMember(m: any, user: any) {
  return {
    userId: m.userId.toString(),
    name: user?.name ?? "",
    email: user?.email ?? "",
    role: m.role,
    status: m.status,
    siteIds: (m.siteIds ?? []).map((id: Types.ObjectId) => id.toString()),
    createdAt: m.createdAt?.toISOString(),
  };
}

function parseUserId(value: string): Types.ObjectId {
  if (!Types.ObjectId.isValid(value)) throw new AppError(404, "NOT_FOUND", "Member not found.");
  return new Types.ObjectId(value);
}

// True when removing this member's active ownership would leave the company without an owner.
async function isLastActiveOwner(companyId: string, memberUserId: Types.ObjectId): Promise<boolean> {
  const otherOwners = await CompanyMemberModel.countDocuments({
    companyId,
    role: "COMPANY_OWNER",
    status: "ACTIVE",
    userId: { $ne: memberUserId },
  });
  return otherOwners === 0;
}

// GET /api/v1/users - members of the caller's company
usersRouter.get(
  "/",
  ...guard("users:read"),
  asyncHandler(async (req: Request, res: Response) => {
    const members = await CompanyMemberModel.find({ companyId: req.tenant!.companyId })
      .sort({ createdAt: 1 })
      .limit(500)
      .lean();
    const users = await UserModel.find({ _id: { $in: members.map((m) => m.userId) } })
      .select("name email")
      .lean();
    const byId = new Map(users.map((u) => [u._id.toString(), u]));
    res.json({
      data: { items: members.map((m) => formatMember(m, byId.get(m.userId.toString()))) },
    });
  })
);

// POST /api/v1/users/invitations
usersRouter.post(
  "/invitations",
  ...guard("users:manage"),
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = inviteUserSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, "VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid invitation");
    }
    const { role, siteIds } = parsed.data;
    const email = parsed.data.email.toLowerCase();

    if (!canGrantRole(req.tenant!.role, role)) {
      throw new AppError(403, "FORBIDDEN", "You cannot grant this role.");
    }
    const sites = await resolveCompanySiteIds(req.tenant!.companyId, siteIds);

    const existingUser = await UserModel.findOne({ email }).select("_id").lean();
    if (existingUser) {
      const alreadyMember = await CompanyMemberModel.exists({
        companyId: req.tenant!.companyId,
        userId: existingUser._id,
        status: "ACTIVE",
      });
      if (alreadyMember) {
        throw new AppError(409, "CONFLICT", "This person is already a member of your company.");
      }
    }

    // Only one open invitation per email and company: a new one replaces the old.
    await InvitationModel.updateMany(
      { companyId: req.tenant!.companyId, email, status: "PENDING" },
      { status: "REVOKED" }
    );

    const { token, tokenHash } = newInvitationToken();
    const expiresAt = new Date(Date.now() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000);
    const invitation = await InvitationModel.create({
      companyId: req.tenant!.companyId,
      email,
      role,
      siteIds: sites,
      tokenHash,
      expiresAt,
      invitedBy: req.user!.id,
    });

    await auditFromRequest(req, "USER_INVITED", "Invitation", invitation._id.toString(), {
      metadata: { email, role, siteCount: sites.length },
    });

    res.status(201).json({
      data: {
        id: invitation._id.toString(),
        email,
        role,
        siteIds: sites.map((s) => s.toString()),
        expiresAt: expiresAt.toISOString(),
        token, // returned once; only its hash is stored
      },
    });
  })
);

// PATCH /api/v1/users/:userId/role
usersRouter.patch(
  "/:userId/role",
  ...guard("users:manage"),
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = changeMemberRoleSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, "VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid role change");
    }
    const userId = parseUserId(req.params.userId);
    const member = await CompanyMemberModel.findOne({ companyId: req.tenant!.companyId, userId });
    if (!member) throw new AppError(404, "NOT_FOUND", "Member not found.");

    const { role, siteIds } = parsed.data;
    if (!canManageMember(req.tenant!.role, member.role) || !canGrantRole(req.tenant!.role, role)) {
      throw new AppError(403, "FORBIDDEN", "You cannot change this member's role.");
    }
    if (member.role === "COMPANY_OWNER" && role !== "COMPANY_OWNER" && member.status === "ACTIVE") {
      if (await isLastActiveOwner(req.tenant!.companyId, userId)) {
        throw new AppError(422, "BUSINESS_RULE_FAILED", "A company must keep at least one active owner.");
      }
    }

    const previousRole = member.role;
    member.role = role;
    if (siteIds !== undefined) {
      member.siteIds = await resolveCompanySiteIds(req.tenant!.companyId, siteIds);
    }
    await member.save();

    await auditFromRequest(req, "MEMBER_ROLE_CHANGED", "User", userId.toString(), {
      metadata: { from: previousRole, to: role, siteCount: member.siteIds.length },
    });

    const user = await UserModel.findById(userId).select("name email").lean();
    res.json({ data: { member: formatMember(member, user) } });
  })
);

// PATCH /api/v1/users/:userId/status - disable or re-enable a member
usersRouter.patch(
  "/:userId/status",
  ...guard("users:manage"),
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = changeMemberStatusSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, "VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid status");
    }
    const userId = parseUserId(req.params.userId);
    const member = await CompanyMemberModel.findOne({ companyId: req.tenant!.companyId, userId });
    if (!member) throw new AppError(404, "NOT_FOUND", "Member not found.");

    if (userId.toString() === req.user!.id) {
      throw new AppError(422, "BUSINESS_RULE_FAILED", "You cannot change your own access.");
    }
    if (!canManageMember(req.tenant!.role, member.role)) {
      throw new AppError(403, "FORBIDDEN", "You cannot change this member.");
    }
    if (
      parsed.data.status === "DISABLED" &&
      member.role === "COMPANY_OWNER" &&
      member.status === "ACTIVE" &&
      (await isLastActiveOwner(req.tenant!.companyId, userId))
    ) {
      throw new AppError(422, "BUSINESS_RULE_FAILED", "A company must keep at least one active owner.");
    }

    const previous = member.status;
    member.status = parsed.data.status;
    await member.save();

    await auditFromRequest(req, "MEMBER_STATUS_CHANGED", "User", userId.toString(), {
      metadata: { from: previous, to: parsed.data.status },
    });

    const user = await UserModel.findById(userId).select("name email").lean();
    res.json({ data: { member: formatMember(member, user) } });
  })
);
