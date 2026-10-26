import type { AuthResponse, MeResponse, User } from "@/types";
import { apiRequest } from "./client";

export const authApi = {
  register: (input: { name: string; email: string; password: string; companyName?: string }) =>
    apiRequest<AuthResponse>("/auth/register", { method: "POST", body: input }),
  login: (input: { email: string; password: string }) =>
    apiRequest<AuthResponse>("/auth/login", { method: "POST", body: input }),
  acceptInvitation: (input: { token: string; name: string; password: string }) =>
    apiRequest<AuthResponse>("/auth/accept-invitation", { method: "POST", body: input }),
  logout: () => apiRequest<null>("/auth/logout", { method: "POST" }),
  me: () => apiRequest<MeResponse>("/auth/me"),
  updateProfile: (input: { name: string }) =>
    apiRequest<{ user: User }>("/auth/me", { method: "PATCH", body: input }),
};
