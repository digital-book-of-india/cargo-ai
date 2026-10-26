// Builds the backend for production with esbuild.
//
// The shared packages (@dbi/api-types, @dbi/validation) are TypeScript source files, so Node cannot
// load them directly. They are bundled into the output; every other dependency stays external and
// is installed with `npm ci --omit=dev`. `tsc --noEmit` (npm run typecheck) still does the type check.
const esbuild = require("esbuild");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const out = path.join(root, "dist");

const entryPoints = [
  "src/server.ts",
  "src/migrations/cli.ts",
  "src/jobs/retention.ts",
  "src/jobs/notifications.ts",
  "src/seeds/seed.ts",
  "src/ops/backup.ts",
  "src/ops/restore.ts",
].map((p) => path.join(root, p));

const externalExceptWorkspace = {
  name: "external-node-modules",
  setup(build) {
    build.onResolve({ filter: /^[^./]/ }, (args) => {
      if (args.path.startsWith("@dbi/") || path.isAbsolute(args.path)) return null; // bundle ours
      return { path: args.path, external: true };
    });
  },
};

fs.rmSync(out, { recursive: true, force: true });
esbuild
  .build({
    entryPoints,
    outdir: out,
    outbase: path.join(root, "src"),
    bundle: true,
    platform: "node",
    target: "node20",
    format: "cjs",
    sourcemap: true,
    logLevel: "info",
    plugins: [externalExceptWorkspace],
  })
  .catch(() => process.exit(1));
