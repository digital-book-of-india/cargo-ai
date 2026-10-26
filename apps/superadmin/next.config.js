/** @type {import("next").NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@dbi/ui", "@dbi/api-types", "@dbi/validation"],
};

module.exports = nextConfig;
