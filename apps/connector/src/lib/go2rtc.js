const { app } = require("electron");
const { spawn } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const log = require("electron-log");

// Runs go2rtc (https://github.com/AlexxIT/go2rtc) next to the cameras. It turns a camera's RTSP
// stream into WebRTC, so the owner's browser can watch live video that flows camera -> this PC ->
// browser. The browser's offer arrives as a job from the backend (see probe.js); this module
// registers the camera's stream with go2rtc and hands back its answer.
//
// go2rtc is bundled by scripts/prepare-python.js into resources/go2rtc. It only listens for the
// API on 127.0.0.1; WebRTC media uses UDP/TCP WEBRTC_PORT. Its own RTSP server is turned off.
const API_PORT = 11984;
const WEBRTC_PORT = 18555;
const API = `http://127.0.0.1:${API_PORT}`;
const READY_TIMEOUT_MS = 8000;

let child = null;
let starting = null;

function binaryPath() {
  if (app.isPackaged) return path.join(process.resourcesPath, "go2rtc", "go2rtc.exe");
  return process.env.THEAFT_GO2RTC || "go2rtc";
}

function writeConfig() {
  const file = path.join(app.getPath("userData"), "go2rtc.yaml");
  fs.writeFileSync(
    file,
    [
      "api:",
      `  listen: "127.0.0.1:${API_PORT}"`,
      "rtsp:",
      '  listen: ""',
      "webrtc:",
      `  listen: ":${WEBRTC_PORT}"`,
      "  ice_servers:",
      '    - urls: ["stun:stun.cloudflare.com:3478"]',
      "log:",
      "  level: warn",
      "",
    ].join("\n")
  );
  return file;
}

async function isReady() {
  try {
    const res = await fetch(`${API}/api/streams`, { signal: AbortSignal.timeout(1000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function launch() {
  const config = writeConfig();
  // stdio is ignored on purpose: go2rtc can print stream URLs, which carry the camera password.
  child = spawn(binaryPath(), ["-config", config], { windowsHide: true, stdio: "ignore" });
  child.on("error", (err) => log.error(`[go2rtc] failed to start: ${err.message}`));
  child.on("exit", (code) => {
    log.warn(`[go2rtc] exited (code ${code})`);
    child = null;
  });
  log.info(`[go2rtc] started (pid ${child.pid})`);

  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (!child) throw new Error("go2rtc exited during start-up");
    if (await isReady()) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("go2rtc did not become ready");
}

// Started on first use and kept running; restarted if it died.
async function ensureRunning() {
  if (child && (await isReady())) return;
  if (!starting) {
    starting = launch().finally(() => {
      starting = null;
    });
  }
  await starting;
}

// Registers the camera's stream (idempotent; the name includes a hash of the URL so an edited
// address becomes a fresh stream) and returns go2rtc's SDP answer for the browser's offer.
async function webrtcAnswer(cameraId, streamUrl, offerSdp) {
  await ensureRunning();
  const name = `cam-${cameraId}-${crypto.createHash("sha1").update(streamUrl).digest("hex").slice(0, 8)}`;

  const put = await fetch(`${API}/api/streams?name=${encodeURIComponent(name)}&src=${encodeURIComponent(streamUrl)}`, {
    method: "PUT",
  });
  if (!put.ok) throw new Error(`go2rtc rejected the stream (${put.status})`);

  const res = await fetch(`${API}/api/webrtc?src=${encodeURIComponent(name)}`, {
    method: "POST",
    headers: { "Content-Type": "application/sdp" },
    body: offerSdp,
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(`go2rtc could not answer (${res.status})`);
  const answer = await res.text();
  if (!answer.startsWith("v=0")) throw new Error("go2rtc returned no SDP answer");
  return answer;
}

function stop() {
  if (child) {
    child.kill();
    child = null;
  }
}

module.exports = { webrtcAnswer, stop };
