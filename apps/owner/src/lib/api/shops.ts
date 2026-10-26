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
};
