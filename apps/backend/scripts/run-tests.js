// Runs backend tests with tsx. Usage: node scripts/run-tests.js [unit|int]
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const mode = process.argv[2] || "unit";
const root = path.join(__dirname, "..", "src");
const suffix = mode === "int" ? ".int.test.ts" : ".test.ts";

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });
}

const files = walk(root).filter((f) => f.endsWith(suffix) && (mode === "int" || !f.endsWith(".int.test.ts")));
if (files.length === 0) {
  console.log("no test files found");
  process.exit(0);
}
const res = spawnSync(process.execPath, ["--import", "tsx", "--test", "--test-concurrency=1", ...files], { stdio: "inherit" });
process.exit(res.status ?? 1);
