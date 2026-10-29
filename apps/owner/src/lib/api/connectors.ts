import { apiRequest } from "./client";

export interface Connector {
  id: string;
  siteId: string;
  name: string;
  status: "ONLINE" | "OFFLINE" | "DEGRADED";
  online: boolean;
  version?: string;
  platform?: string;
  lastHeartbeatAt?: string;
  createdAt: string;
}

export const connectorsApi = {
  list: async (siteId: string): Promise<{ connectors: Connector[] }> => {
    try {
      const res = await apiRequest<{ items?: Connector[]; connectors?: Connector[] }>(`/sites/${siteId}/connectors`);
      const items = res.items ?? res.connectors ?? [];
      return {
        connectors: items.map((c) => ({
          ...c,
          online: c.status === "ONLINE",
        })),
      };
    } catch {
      return { connectors: [] };
    }
  },
};
