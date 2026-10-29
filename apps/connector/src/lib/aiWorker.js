const { app } = require("electron");
const { spawn } = require("child_process");
const path = require("path");
const log = require("electron-log");
const { BACKEND_URL } = require("./config");

// Runs the AI monitoring worker (apps/ai-worker, Python + OpenCV) on this site PC, so it can
// read the cameras on the local network. The installer bundles an embedded Python plus the
// worker source (see scripts/prepare-python.js); the worker authenticates to the backend with
// this connector's own token. If it dies it is restarted with a growing delay.
const MIN_RESTART_MS = 5 * 1000;
const MAX_RESTART_MS = 60 * 1000;
const HEALTHY_RUN_MS = 60 * 1000;

let child = null;
let stopped = true;
let restartTimer = null;
let restartDelay = MIN_RESTART_MS;

function runtimePaths() {
  if (app.isPackaged) {
    return {
      python: path.join(process.resourcesPath, "python", "python.exe"),
      src: path.join(process.resourcesPath, "ai-worker", "src"),
    };
  }
  // Dev: system Python (needs `pip install -r apps/ai-worker/requirements.txt`).
  return {
    python: process.env.THEAFT_PYTHON || "python",
    src: path.join(__dirname, "..", "..", "..", "ai-worker", "src"),
  };
}

// OpenCV/FFmpeg print the full RTSP URL (with camera password) on connection errors.
function redact(line) {
  return line.replace(/(rtsp:\/\/)[^@\s/]+@/gi, "$1***@");
}

function pipeLines(stream, level) {
  let buf = "";
  stream.on("data", (chunk) => {
    buf += chunk.toString("utf8");
    const lines = buf.split(/\r?\n/);
    buf = lines.pop();
    for (const line of lines) if (line.trim()) log[level](`[ai-worker] ${redact(line)}`);
  });
}

function launch(identity) {
  if (stopped) return;
  const { python, src } = runtimePaths();
  const startedAt = Date.now();

  child = spawn(python, ["main.py"], {
    cwd: src,
    windowsHide: true,
    env: {
      ...process.env,
      BACKEND_URL,
      CONNECTOR_TOKEN: identity.connectorToken,
      WORKER_ID: `connector-${identity.connectorId}`,
      PYTHONUNBUFFERED: "1",
      PYTHONIOENCODING: "utf-8",
    },
  });
  log.info(`[ai-worker] started (pid ${child.pid})`);
  pipeLines(child.stdout, "info");
  pipeLines(child.stderr, "warn");

  child.on("error", (err) => log.error(`[ai-worker] failed to start: ${err.message}`));
  child.on("exit", (code) => {
    child = null;
    if (stopped) return;
    if (Date.now() - startedAt > HEALTHY_RUN_MS) restartDelay = MIN_RESTART_MS;
    log.warn(`[ai-worker] exited (code ${code}); restarting in ${restartDelay / 1000}s`);
    restartTimer = setTimeout(() => launch(identity), restartDelay);
    restartDelay = Math.min(restartDelay * 2, MAX_RESTART_MS);
  });
}

function start(identity) {
  stop();
  stopped = false;
  restartDelay = MIN_RESTART_MS;
  launch(identity);
}

function stop() {
  stopped = true;
  if (restartTimer) clearTimeout(restartTimer);
  restartTimer = null;
  if (child) {
    child.kill();
    child = null;
  }
}

module.exports = { start, stop, runtimePaths };
