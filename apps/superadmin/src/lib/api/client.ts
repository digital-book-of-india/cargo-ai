import type { ApiErrorBody } from "@/types";

export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000/api/v1";
export const USE_MOCKS = process.env.NEXT_PUBLIC_USE_MOCKS === "true";

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

async function request<T>(path: string, opts: RequestOptions = {}) {
  const url = new URL(API_BASE_URL + path);
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
  }

  const token = typeof window !== "undefined" ? localStorage.getItem("dbi_admin_token") : null;
  const headers: Record<string, string> = {};

  if (opts.body) {
    headers["Content-Type"] = "application/json";
  }

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

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

    if (typeof window !== "undefined") {
      if (res.status === 401) {
        localStorage.removeItem("dbi_admin_token");
        window.location.href = "/login";
      } else if (res.status === 403 && path.startsWith("/admin")) {
        window.location.href = "/access-denied";
      }
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