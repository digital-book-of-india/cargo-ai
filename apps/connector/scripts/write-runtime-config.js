// Bakes the backend URL into the app BEFORE packaging. A packaged exe has no .env file and
// no access to the env vars of the machine that built it, so this must run as a "pre" step
// (see package.json's predist/prepublish/prestart hooks) and its output must be bundled
// via electron-builder's `files` list (src/**/*).
const fs = require("fs");
const path = require("path");

const backendUrl = (process.env.THEAFT_BACKEND_URL || "http://localhost:4000").replace(/\/+$/, "");
const outFile = path.join(__dirname, "..", "src", "lib", "runtime-config.json");

fs.writeFileSync(outFile, JSON.stringify({ backendUrl }, null, 2) + "\n", "utf8");
console.log(`[theaft-connector] baked THEAFT_BACKEND_URL=${backendUrl} into ${outFile}`);
