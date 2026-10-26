import type { Connector, ConnectorWithPairingCode } from "@/types";
import { apiRequest } from "./client";

export const connectorsApi = {
  create: (shopId: string, name: string) =>
    apiRequest<{ connector: ConnectorWithPairingCode }>(`/shops/${shopId}/connectors`, {
      method: "POST",
      body: { name },
    }),

  list: async (shopId: string): Promise<{ connectors: Connector[] }> => {
    const res = await apiRequest<{ items?: Connector[] }>(`/shops/${shopId}/connectors`);
    return { connectors: res.items ?? [] };
  },

  regeneratePairingCode: (connectorId: string) =>
    apiRequest<{ connector: ConnectorWithPairingCode }>(`/connectors/${connectorId}/pairing-code`, {
      method: "POST",
    }),

  revoke: (connectorId: string) =>
    apiRequest<null>(`/connectors/${connectorId}`, { method: "DELETE" }),
};
