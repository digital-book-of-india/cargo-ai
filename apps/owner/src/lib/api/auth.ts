import type { User } from "@/types";
import { apiRequest } from "./client";

export const authApi = {
  register: (input: { name: string; email: string; password: string }) =>
    apiRequest<{ user: User }>("/auth/register", { method: "POST", body: input }),
  login: (input: { email: string; password: string }) =>
    apiRequest<{ user: User }>("/auth/login", { method: "POST", body: input }),
  logout: () => apiRequest<null>("/auth/logout", { method: "POST" }),
  me: () => apiRequest<{ user: User }>("/auth/me"),
  // Not in the handoff catalogue yet.
  updateProfile: (input: { name: string }) =>
    apiRequest<{ user: User }>("/auth/me", { method: "PATCH", body: input }),
};
