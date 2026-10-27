import type { ApiErrorBody } from "@/types";
import { ApiError } from "./errors";

export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000/api/v1";

// A request that has not answered by then is reported as a timeout.
export const REQUEST_TIMEOUT_MS = Number(process.env.NEXT_PUBLIC_REQUEST_TIMEOUT_MS ?? 20_000);

export { ApiError };

// Called when a non-auth request comes back 401 (session expired or revoked).
let unauthorizedHandler: (() => void) | null = null;
export function setUnauthorizedHandler(handler: (() => void) | null) {
  unauthorizedHandler = handler;
}

interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  signal?: AbortSignal;
}

// Single entry point for all backend calls. Success responses are { data: T }.
export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  try {
    return await send<T>(path, options);
  } catch (err) {
    // /auth/* answers 401 for "not signed in" or "wrong password"; callers handle those.
    if (err instanceof ApiError && err.status === 401 && !path.startsWith("/auth/")) {
      unauthorizedHandler?.();
    }
    throw err;
  }
}

async function send<T>(
  path: string,
  { method = "GET", body, query, signal }: RequestOptions
): Promise<T> {
  const url = new URL(API_BASE_URL + path);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
  }

  const res = await fetchWithTimeout(
    url.toString(),
    {
      method,
      headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: "include", // session cookie
    },
    signal
  );
  return await readResponse<T>(res);
}

// One signal for both "the caller gave up" and "the server took too long".
async function fetchWithTimeout(url: string, init: RequestInit, signal?: AbortSignal): Promise<Response> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, REQUEST_TIMEOUT_MS);
  const onCallerAbort = () => controller.abort();
  signal?.addEventListener("abort", onCallerAbort);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch {
    if (timedOut) {
      throw new ApiError(0, "TIMEOUT", "The server took too long to answer. Please try again.");
    }
    if (signal?.aborted) throw new ApiError(0, "ABORTED", "The request was cancelled.");
    throw new ApiError(0, "NETWORK_ERROR", "Cannot reach the server. Please try again.");
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onCallerAbort);
  }
}

// A file (for example the CSV export): the same timeout, error handling and session-expiry handling as every other call.
export async function apiDownload(
  path: string,
  query: Record<string, string | number | undefined> = {},
  defaultName = "download"
): Promise<{ blob: Blob; fileName: string }> {
  try {
    const url = new URL(API_BASE_URL + path);
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
    const res = await fetchWithTimeout(url.toString(), { credentials: "include" });
    if (!res.ok) return await readResponse<never>(res); // throws the server's error
    const match = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "");
    return { blob: await res.blob(), fileName: match?.[1] ?? defaultName };
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) unauthorizedHandler?.();
    throw err;
  }
}

// The API hands out some addresses as a path on its own host ("/api/v1/evidence/...", "/api/v1/cameras/.../preview").
// A picture or clip must be requested from the API host: the same path on the panel's host is a 404.
export function apiAssetUrl(pathOrUrl: string): string {
  if (!pathOrUrl.startsWith("/") || pathOrUrl.startsWith("//")) return pathOrUrl;
  try {
    return new URL(API_BASE_URL).origin + pathOrUrl;
  } catch {
    return pathOrUrl; // the API is on the same host as the panel
  }
}

// Turns a fetch Response into data or an ApiError. Tolerates empty bodies (204), bodies that
// are not JSON (proxy error pages) and success bodies without the { data } wrapper.
export async function readResponse<T>(res: Response): Promise<T> {
  const text = await res.text().catch(() => "");
  let json: unknown = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }

  if (!res.ok) {
    const err = (json as ApiErrorBody | null)?.error;
    throw new ApiError(
      res.status,
      err?.code ?? "UNKNOWN_ERROR",
      err?.message ?? "Something went wrong.",
      err?.requestId
    );
  }

  if (json && typeof json === "object" && "data" in json) {
    return (json as { data: T }).data;
  }
  return (json ?? null) as T;
}
