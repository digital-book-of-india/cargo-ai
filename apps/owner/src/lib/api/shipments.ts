import type {
  CloseLoadingSessionRequest,
  CloseSessionResult,
  CreateLoadingSessionRequest,
  CreateManifestRequest,
  LoadingSession,
  Manifest,
  ManifestImportJob,
  UpdateManifestRequest,
  Vehicle,
} from "@/types";
import { apiRequest } from "./client";

type Query = Record<string, string | number | undefined>;

export const vehiclesApi = {
  list: async () => (await apiRequest<{ items: Vehicle[] }>("/vehicles")).items,
  create: (input: { registrationNumber: string; label?: string }) =>
    apiRequest<{ vehicle: Vehicle }>("/vehicles", { method: "POST", body: input }),
  update: (id: string, input: { label?: string | null; active?: boolean }) =>
    apiRequest<{ vehicle: Vehicle }>(`/vehicles/${id}`, { method: "PATCH", body: input }),
};

export const manifestsApi = {
  list: (q: { siteId?: string; status?: string; q?: string; cursor?: string; limit?: number } = {}) =>
    apiRequest<{ items: Manifest[]; nextCursor: string | null }>("/manifests", { query: q as Query }),
  create: (input: CreateManifestRequest) => apiRequest<{ manifest: Manifest }>("/manifests", { method: "POST", body: input }),
  update: (id: string, input: UpdateManifestRequest) =>
    apiRequest<{ manifest: Manifest }>(`/manifests/${id}`, { method: "PATCH", body: input }),
  // the CSV text is sent as JSON; the server checks every row
  importCsv: async (fileName: string, content: string, allowPartial: boolean) =>
    (await apiRequest<{ job: ManifestImportJob }>("/manifests/import", { method: "POST", body: { fileName, content, allowPartial } })).job,
};

export const sessionsApi = {
  list: (q: { siteId?: string; open?: boolean; reconciliationStatus?: string; cursor?: string; limit?: number } = {}) =>
    apiRequest<{ items: LoadingSession[]; nextCursor: string | null }>("/loading-sessions", {
      query: { ...q, open: q.open ? "true" : undefined } as Query,
    }),
  get: async (id: string) => (await apiRequest<{ session: LoadingSession }>(`/loading-sessions/${id}`)).session,
  start: async (input: CreateLoadingSessionRequest) =>
    (await apiRequest<{ session: LoadingSession }>("/loading-sessions", { method: "POST", body: input })).session,
  close: (id: string, input: CloseLoadingSessionRequest = {}) =>
    apiRequest<CloseSessionResult>(`/loading-sessions/${id}/close`, { method: "POST", body: input }),
};
