export const PUBLIC_PATHS = ["/login", "/register"];

// Only allow same-site relative paths after login (prevents open redirects).
export function safeNextPath(raw: string | null | undefined, fallback = "/dashboard"): string {
  if (!raw) return fallback;
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return fallback;
  if (/[\u0000-\u001f]/.test(raw)) return fallback;
  if (PUBLIC_PATHS.some((p) => raw === p || raw.startsWith(p + "?") || raw.startsWith(p + "/"))) {
    return fallback;
  }
  return raw;
}
