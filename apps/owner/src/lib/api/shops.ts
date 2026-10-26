import type { SecurityState } from "@/lib/security";
import type { Shop } from "@/types";
import { apiRequest } from "./client";

export const shopsApi = {
  create: (input: { name: string; timezone: string; address?: Shop["address"] }) =>
    apiRequest<{ shop: Shop }>("/shops", { method: "POST", body: input }),
  // The API answers { items }; { shops } is accepted too.
  list: async (): Promise<{ shops: Shop[] }> => {
    const res = await apiRequest<{ items?: Shop[]; shops?: Shop[] }>("/shops");
    return { shops: res.items ?? res.shops ?? [] };
  },
  get: (shopId: string) => apiRequest<{ shop: Shop }>(`/shops/${shopId}`),
  update: (shopId: string, input: Partial<Pick<Shop, "name" | "timezone" | "address">>) =>
    apiRequest<{ shop: Shop }>(`/shops/${shopId}`, { method: "PATCH", body: input }),
  securityState: (shopId: string) =>
    apiRequest<SecurityState>(`/shops/${shopId}/security-state`),
  // Body as defined by the API: action, optional duration, and a required reason (audit log).
  override: (shopId: string, input: { action: "ARM" | "DISARM"; durationMinutes?: number; reason: string }) =>
    apiRequest<unknown>(`/shops/${shopId}/override`, { method: "POST", body: input }),
};
