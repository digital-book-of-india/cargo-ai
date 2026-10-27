import type { ApiErrorBody } from "@/types";

export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000/api/v1";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public requestId?: string
  ) {
    super(message);
  }
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  signal?: AbortSignal;
}

// Earlier versions of this panel kept the admin token in localStorage, where any script on the page could read it. The
// panel no longer writes it, and removes a copy left behind in a browser that used an older version.
export function clearLegacyAdminToken(): void {
  try {
    if (typeof window !== "undefined") window.localStorage.removeItem("dbi_admin_token");
  } catch {
    // storage can be blocked; there is nothing to clean up then
  }
}

// The session lives in an httpOnly cookie that only the API can read or write. Nothing about the session is kept
// where a script on the page could reach it (no token in localStorage, no Authorization header from the browser).
async function request<T>(path: string, opts: RequestOptions = {}) {
  const url = new URL(API_BASE_URL + path);
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
  }

  const headers: Record<string, string> = {};
  if (opts.body) headers["Content-Type"] = "application/json";

  let res: Response;
  try {
    res = await fetch(url.toString(), {
      method: opts.method ?? "GET",
      headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      credentials: "include",
      signal: opts.signal,
    });
  } catch {
    throw new ApiError(0, "NETWORK_ERROR", "Cannot reach the server. Please try again.");
  }

  const json = await res.json().catch(() => null);

  if (!res.ok) {
    const err = (json as ApiErrorBody | null)?.error;

    // The session has ended: sign in again. A 403 is NOT a reason to leave the page: it only means this one action is
    // not allowed (for example an event that does not exist for the support tool), and the caller shows that.
    if (res.status === 401 && typeof window !== "undefined" && window.location.pathname !== "/login") {
      window.location.href = "/login";
    }

    throw new ApiError(
      res.status,
      err?.code ?? "UNKNOWN_ERROR",
      err?.message ?? "Something went wrong.",
      err?.requestId
    );
  }

  return json as { data: T; meta?: PaginationMeta };
}

export async function apiRequest<T>(path: string, opts?: RequestOptions): Promise<T> {
  const j = await request<T>(path, opts);
  return j.data;
}

export async function apiRequestList<T extends object>(
  path: string,
  opts?: RequestOptions
): Promise<T & { meta: PaginationMeta }> {
  const j = await request<T>(path, opts);
  return {
    ...j.data,
    meta: j.meta ?? { page: 1, limit: 20, total: 0, totalPages: 1 },
  };
}
