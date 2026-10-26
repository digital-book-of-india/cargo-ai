import crypto from "crypto";
import type { CompanyMembership, User } from "@dbi/api-types";
import { CompanyMemberModel, CompanyModel } from "../../models";

export function formatUser(user: any): User {
  return {
    id: user._id.toString(),
    name: user.name,
    email: user.email,
    role: user.role,
    status: user.status,
    createdAt: user.createdAt.toISOString(),
  };
}

// Memberships of one user in companies that are active. Disabled memberships and suspended
// companies are left out, so the UI never offers a company the user cannot act in.
export async function loadMemberships(userId: string): Promise<CompanyMembership[]> {
  const members = await CompanyMemberModel.find({ userId, status: "ACTIVE" }).sort({ createdAt: 1 }).lean();
  if (members.length === 0) return [];
  const companies = await CompanyModel.find({
    _id: { $in: members.map((m) => m.companyId) },
    status: "ACTIVE",
  })
    .select("_id name")
    .lean();
  const names = new Map(companies.map((c) => [c._id.toString(), c.name]));
  return members
    .filter((m) => names.has(m.companyId.toString()))
    .map((m) => ({
      companyId: m.companyId.toString(),
      companyName: names.get(m.companyId.toString())!,
      role: m.role,
      status: m.status,
      siteIds: (m.siteIds ?? []).map((id) => id.toString()),
    }));
}

export function newInvitationToken(): { token: string; tokenHash: string } {
  const token = crypto.randomBytes(32).toString("base64url");
  return { token, tokenHash: hashInvitationToken(token) };
}

export function hashInvitationToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}
