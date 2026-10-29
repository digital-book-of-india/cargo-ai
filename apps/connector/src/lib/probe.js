const net = require("net");
const path = require("path");
const { spawn } = require("child_process");
const { EventEmitter } = require("events");
const api = require("./api");
const aiWorker = require("./aiWorker");
const go2rtc = require("./go2rtc");
const { describe } = require("./rtsp");
const { JOB_POLL_INTERVAL_MS } = require("./config");

// Runs the jobs the web app queues for this site. The backend can't reach a camera's private LAN
// address, so it asks this Connector - which sits on that LAN - and reports the answer back:
//   PROBE    - "Test connection": is the camera reachable, and are the login and path right?
//   WEBRTC   - "Live view": answer the browser's WebRTC offer with a go2rtc stream of the camera
//   DISCOVER - "Find channels": which channels does this recorder offer, with a thumbnail each?
const MAX_CHANNELS = 32;
const SCAN_CONCURRENCY = 2; // low on purpose: cameras refuse more than a few RTSP connections
const THUMB_CONCURRENCY = 2;
const DETECT_CHANNELS = [1, 2, 3, 4];
const THUMB_TIMEOUT_MS = 15000;

// Recorder stream paths, tried in order. {n} is the channel number.
const PATH_SCHEMES = [
  { name: "hikvision", pathFor: (n) => `/Streaming/Channels/${n}01`, subPathFor: (n) => `/Streaming/Channels/${n}02`, matches: /^\/Streaming\/Channels\/\d+/i },
  { name: "dahua", pathFor: (n) => `/cam/realmonitor?channel=${n}&subtype=0`, subPathFor: (n) => `/cam/realmonitor?channel=${n}&subtype=1`, matches: /^\/cam\/realmonitor/i },
];

function tcpProbe(streamUrl, timeoutMs = 4000) {
  return new Promise((resolve) => {
    let host;
    let port;
    try {
      const parsed = new URL(streamUrl);
      host = parsed.hostname;
      port = Number(parsed.port) || (parsed.protocol === "rtsp:" ? 554 : 80);
    } catch {
      return resolve({ reachable: false, errorCode: "INVALID_STREAM_URL" });
    }
    if (!host) return resolve({ reachable: false, errorCode: "INVALID_STREAM_URL" });

    const socket = new net.Socket();
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish({ reachable: true }));
    socket.once("timeout", () => finish({ reachable: false, errorCode: "CONNECTION_TIMEOUT" }));
    socket.once("error", () => finish({ reachable: false, errorCode: "CONNECTION_REFUSED" }));
    socket.connect(port, host);
  });
}

// Port reachable, then (for RTSP) ask the camera for the stream with the saved login.
async function probeCamera(streamUrl) {
  const tcp = await tcpProbe(streamUrl);
  if (!tcp.reachable || !/^rtsp:/i.test(streamUrl)) return tcp;

  const { status } = await describe(streamUrl, 5000);
  if (status === 200) return { reachable: true };
  if (status === 401 || status === 403) return { reachable: false, errorCode: "AUTH_FAILED" };
  if (status === 404) return { reachable: false, errorCode: "STREAM_PATH_NOT_FOUND" };
  if (status === null) return { reachable: false, errorCode: "NO_RTSP_RESPONSE" };
  // Some other RTSP status: the port answers; the worker's real frame check decides.
  return { reachable: true };
}

function withPath(streamUrl, pathAndQuery) {
  const u = new URL(streamUrl);
  const [pathname, ...query] = pathAndQuery.split("?");
  u.pathname = pathname;
  u.search = query.length ? `?${query.join("?")}` : "";
  return u.toString();
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await fn(items[i], i);
      }
    })
  );
  return results;
}

// One small JPEG of the stream as a data URL (null if it could not be grabbed). Runs the bundled
// Python/OpenCV helper, since decoding video is what OpenCV is already here for.
function grabThumbnail(streamUrl) {
  return new Promise((resolve) => {
    const { python, src } = aiWorker.runtimePaths();
    let out = "";
    let child;
    try {
      child = spawn(python, [path.join("tools", "grab_frame.py"), streamUrl], { cwd: src, windowsHide: true });
    } catch {
      return resolve(null);
    }
    const timer = setTimeout(() => child.kill(), THUMB_TIMEOUT_MS);
    child.stdout.on("data", (d) => (out += d.toString("utf8")));
    child.on("error", () => {
      clearTimeout(timer);
      resolve(null);
    });
    child.on("close", () => {
      clearTimeout(timer);
      try {
        const last = out.trim().split(/\r?\n/).pop();
        const parsed = JSON.parse(last);
        resolve(parsed.jpeg ? `data:image/jpeg;base64,${parsed.jpeg}` : null);
      } catch {
        resolve(null);
      }
    });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Cheap cameras only allow a few RTSP connections at once (and the AI worker already holds one),
// so a refused/dropped answer gets one retry instead of being read as "no such channel".
async function describeWithRetry(url) {
  let r = await describe(url, 4000);
  if (r.status === null) {
    await sleep(800);
    r = await describe(url, 4000);
  }
  return r;
}

const isAuthError = (status) => status === 401 || status === 403;

// "200", or "null(ECONNRESET)" / "null(NOT_RTSP: HTTP/1.1 400)" when the camera gave no RTSP answer.
const fmt = (r) => `${r.status}${r.status === null ? `(${r.error || "?"}${r.raw ? `: ${r.raw}` : ""})` : ""}`;

// Lists what this address offers:
//  - a recorder (NVR/DVR) with numbered channels -> every channel that has video, or
//  - a single camera -> just itself.
// `debug` carries the RTSP status codes seen (and, for no answer, why), so a failure can be explained instead of guessed.
async function discoverChannels(streamUrl) {
  const tcp = await tcpProbe(streamUrl);
  if (!tcp.reachable) return { channels: [], error: tcp.errorCode };

  const debug = [];
  const own = await describeWithRetry(streamUrl);
  debug.push(`own=${fmt(own)}`);
  if (isAuthError(own.status)) return { channels: [], error: "AUTH_FAILED", debug: debug.join(" ") };

  const ownUrl = new URL(streamUrl);
  const ownPath = `${ownUrl.pathname}${ownUrl.search}`;

  // Is this a recorder? The saved path may already say so; otherwise try channels 1-4, one at a time.
  let scheme = PATH_SCHEMES.find((s) => s.matches.test(ownPath)) || null;
  if (!scheme) {
    detect: for (const candidate of PATH_SCHEMES) {
      for (const n of DETECT_CHANNELS) {
        const r = await describeWithRetry(withPath(streamUrl, candidate.pathFor(n)));
        debug.push(`${candidate.name}${n}=${fmt(r)}`);
        if (isAuthError(r.status)) return { channels: [], error: "AUTH_FAILED", debug: debug.join(" ") };
        if (r.status === 200 && r.hasVideo) {
          scheme = candidate;
          break detect;
        }
      }
    }
  }

  if (scheme) {
    const numbers = Array.from({ length: MAX_CHANNELS }, (_, i) => i + 1);
    const checked = await mapLimit(numbers, SCAN_CONCURRENCY, async (n) => {
      const pathAndQuery = scheme.pathFor(n);
      const url = withPath(streamUrl, pathAndQuery);
      const r = await describeWithRetry(url);
      return { n, url, path: pathAndQuery, status: r.status, ok: r.status === 200 && r.hasVideo };
    });
    const found = checked.filter((c) => c.ok);
    debug.push(`${scheme.name}-scan: ${found.length}/${MAX_CHANNELS} with video`);
    if (found.length > 0) {
      // Prefer each channel's sub-stream: much lighter to decode (the shop PC watches every
      // camera all day) and the usual choice for AI and live view. Falls back to the main stream.
      await mapLimit(found, SCAN_CONCURRENCY, async (c) => {
        const subPath = scheme.subPathFor(c.n);
        const subUrl = withPath(streamUrl, subPath);
        const r = await describeWithRetry(subUrl);
        if (r.status === 200 && r.hasVideo) {
          c.path = subPath;
          c.url = subUrl;
        }
      });
      const thumbs = await mapLimit(found, THUMB_CONCURRENCY, (c) => grabThumbnail(c.url));
      return {
        channels: found.map((c, i) => ({ channel: c.n, label: `Channel ${c.n}`, path: c.path, thumbnail: thumbs[i] })),
        debug: debug.join(" "),
      };
    }
  }

  // Not a recorder: a single camera is just its own stream.
  if (own.status === 200 && own.hasVideo) {
    const thumbnail = await grabThumbnail(streamUrl);
    return { channels: [{ channel: 1, label: "This camera", path: ownPath, thumbnail }], debug: debug.join(" ") };
  }
  return { channels: [], error: "NO_CHANNELS_FOUND", debug: debug.join(" ") };
}

class JobRunner extends EventEmitter {
  constructor() {
    super();
    this.timer = null;
  }

  async runJob(token, job) {
    try {
      let result;
      if (job.type === "DISCOVER") result = await discoverChannels(job.streamUrl);
      else if (job.type === "WEBRTC") result = { answer: await go2rtc.webrtcAnswer(job.cameraId, job.streamUrl, job.payload) };
      else result = await probeCamera(job.streamUrl);
      await api.postJobResult(token, job.jobId, result);
    } catch (err) {
      this.emit("error", err);
      const failed =
        job.type === "DISCOVER"
          ? { channels: [], error: "SCAN_FAILED" }
          : job.type === "WEBRTC"
          ? { error: "WEBRTC_FAILED" }
          : { reachable: false, errorCode: "PROBE_FAILED" };
      await api.postJobResult(token, job.jobId, failed).catch(() => undefined);
    }
  }

  start(getToken) {
    this.stop();
    const tick = async () => {
      const token = getToken();
      if (!token) return;
      try {
        const { data } = await api.listJobs(token);
        // Not awaited: a slow channel scan must not hold up the next camera test.
        for (const job of data?.items || []) void this.runJob(token, job);
      } catch (err) {
        this.emit("error", err);
      }
    };
    this.timer = setInterval(tick, JOB_POLL_INTERVAL_MS);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

module.exports = new JobRunner();

module.exports._test = { probeCamera, discoverChannels };
