import type { ApiErrorBody } from "@/types";
import { ApiError } from "./errors";

export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000/api/v1";
export const USE_MOCKS = process.env.NEXT_PUBLIC_USE_MOCKS === "true";

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
// With NEXT_PUBLIC_USE_MOCKS=true the same call is answered by src/mocks (DEMO data).
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
  if (USE_MOCKS) {
    // Dynamic import keeps the mock layer out of the bundle when mocks are off.
    const { mockRequest } = await import("@/mocks/handlers");
    return mockRequest<T>(path, { method, body, query });
  }

  const url = new URL(API_BASE_URL + path);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
  }

  // One signal for both "the caller gave up" and "the server took too long".
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, REQUEST_TIMEOUT_MS);
  const onCallerAbort = () => controller.abort();
  signal?.addEventListener("abort", onCallerAbort);

  try {
    let res: Response;
    try {
      res = await fetch(url.toString(), {
        method,
        headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        credentials: "include", // session cookie; revisit if the backend uses bearer tokens
        signal: controller.signal,
      });
    } catch {
      if (timedOut) {
        throw new ApiError(0, "TIMEOUT", "The server took too long to answer. Please try again.");
      }
      if (signal?.aborted) throw new ApiError(0, "ABORTED", "The request was cancelled.");
      throw new ApiError(0, "NETWORK_ERROR", "Cannot reach the server. Please try again.");
    }

    return await readResponse<T>(res);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onCallerAbort);
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
  // 204 / empty body / unwrapped payload
  return (json ?? null) as T;
}
