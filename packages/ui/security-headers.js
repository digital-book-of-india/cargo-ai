// Browser security headers shared by both panels (next.config.js of each app calls this).
//
// The Content-Security-Policy limits where a page may load things from and send things to. Scripts must come from the
// panel itself (Next needs 'unsafe-inline' for its own start-up code; development also needs 'unsafe-eval' for hot
// reload), and the page may talk to the panel's own origin and to the API origin only: a script that somehow got into the
// page could not send data to another site. Pictures and clips come from the API (signed links), so its origin is allowed.

function apiOrigin() {
  try {
    return new URL(process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:4000/api/v1").origin;
  } catch {
    return "http://localhost:4000";
  }
}

// frameAncestors: "'none'" for the admin panel (it must never be shown inside another page), "'self'" for the owner panel
function securityHeaders({ frameAncestors = "'none'" } = {}) {
  const dev = process.env.NODE_ENV !== "production";
  const api = apiOrigin();
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: ${api}`,
    `media-src 'self' blob: ${api}`,
    `connect-src 'self' ${api}${dev ? " ws: wss:" : ""}`,
    "font-src 'self' data:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    `frame-ancestors ${frameAncestors}`,
  ].join("; ");

  return [
    { key: "Content-Security-Policy", value: csp },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: frameAncestors === "'none'" ? "DENY" : "SAMEORIGIN" },
    // evidence links and camera addresses must not leak through the Referer header
    { key: "Referrer-Policy", value: "no-referrer" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  ];
}

module.exports = { securityHeaders };
