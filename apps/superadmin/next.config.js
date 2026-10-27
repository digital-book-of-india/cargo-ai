const { securityHeaders } = require("../../packages/ui/security-headers");

/** @type {import("next").NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders({ frameAncestors: "'none'" }) }];
  },
  // NEXT_DIST_DIR lets a second build use its own folder without clobbering a running dev server
  distDir: process.env.NEXT_DIST_DIR || ".next",
  transpilePackages: ["@dbi/ui", "@dbi/api-types", "@dbi/validation"],
};

module.exports = nextConfig;
