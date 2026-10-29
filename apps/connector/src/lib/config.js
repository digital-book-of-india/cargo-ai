const { app } = require("electron");
const path = require("path");

// Baked in at BUILD time by scripts/write-runtime-config.js (see package.json's
// predist/prepublish/prestart hooks) - a packaged exe has no .env and no access to the env
// vars of the machine that built it, so this cannot be read from process.env at runtime.
let runtimeConfig = {};
try {
  runtimeConfig = require("./runtime-config.json");
} catch {
  // not generated yet (e.g. first `electron .` before any npm script ran) - dev fallback below.
}

const BACKEND_URL = (runtimeConfig.backendUrl || "http://localhost:4000").replace(/\/+$/, "");

const HEARTBEAT_INTERVAL_MS = 20 * 1000;
const CAMERA_SYNC_INTERVAL_MS = 60 * 1000;
const JOB_POLL_INTERVAL_MS = 3 * 1000;
const UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

function userDataPath(...segments) {
  return path.join(app.getPath("userData"), ...segments);
}

module.exports = {
  BACKEND_URL,
  HEARTBEAT_INTERVAL_MS,
  CAMERA_SYNC_INTERVAL_MS,
  JOB_POLL_INTERVAL_MS,
  UPDATE_CHECK_INTERVAL_MS,
  STORE_FILE: () => userDataPath("connector-store.json"),
};
