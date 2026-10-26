/** @type {import("next").NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // NEXT_DIST_DIR lets a second build use its own folder without clobbering a running dev server
  distDir: process.env.NEXT_DIST_DIR || ".next",
  transpilePackages: ["@dbi/ui", "@dbi/api-types", "@dbi/validation"],
};

module.exports = nextConfig;
