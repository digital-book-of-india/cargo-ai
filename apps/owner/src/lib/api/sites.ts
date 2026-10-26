import type { Site } from "@/types";
import { apiRequest } from "./client";

export const sitesApi = {
  create: (input: { name: string; code: string; timezone: string; address?: Site["address"] }) =>
    apiRequest<{ site: Site }>("/sites", { method: "POST", body: input }),
  // The API answers { items }; { sites } is accepted too.
  list: async (opts: { includeArchived?: boolean } = {}): Promise<{ sites: Site[] }> => {
    const res = await apiRequest<{ items?: Site[]; sites?: Site[] }>("/sites", {
      query: opts.includeArchived ? { includeArchived: "true" } : undefined,
    });
    return { sites: res.items ?? res.sites ?? [] };
  },
  get: (siteId: string) => apiRequest<{ site: Site }>(`/sites/${siteId}`),
  update: (siteId: string, input: Partial<Pick<Site, "name" | "code" | "timezone" | "address">> & { status?: "ACTIVE" | "INACTIVE" }) =>
    apiRequest<{ site: Site }>(`/sites/${siteId}`, { method: "PATCH", body: input }),
  // Archives the site; the API refuses while it still has cameras or zones.
  archive: (siteId: string) => apiRequest<{ site: Site }>(`/sites/${siteId}`, { method: "DELETE" }),
};
