import type { CompanyMember, CompanyRole, InvitationResponse, MemberStatus } from "@/types";
import { apiRequest } from "./client";

export const usersApi = {
  list: async (): Promise<CompanyMember[]> => (await apiRequest<{ items: CompanyMember[] }>("/users")).items,
  invite: (input: { email: string; role: CompanyRole; siteIds: string[] }) =>
    apiRequest<InvitationResponse>("/users/invitations", { method: "POST", body: input }),
  changeRole: (userId: string, input: { role: CompanyRole; siteIds?: string[] }) =>
    apiRequest<{ member: CompanyMember }>(`/users/${userId}/role`, { method: "PATCH", body: input }),
  setStatus: (userId: string, status: MemberStatus) =>
    apiRequest<{ member: CompanyMember }>(`/users/${userId}/status`, { method: "PATCH", body: { status } }),
};
