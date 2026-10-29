const { BACKEND_URL } = require("./config");

// A request that hangs (a dropped connection) must fail, not wait forever.
const REQUEST_TIMEOUT_MS = 15 * 1000;

async function postJson(path, body, token) {
  const res = await fetch(`${BACKEND_URL}${path}`, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { "x-connector-token": token } : {}),
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data?.error?.message || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

async function getJson(path, token) {
  const res = await fetch(`${BACKEND_URL}${path}`, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: token ? { "x-connector-token": token } : {},
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data?.error?.message || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

// Exchanges a one-time pairing code (generated in the web admin) for a long-lived
// connector token. See apps/backend POST /internal/v1/connectors/pair.
function pair(pairingCode) {
  return postJson("/internal/v1/connectors/pair", { pairingCode });
}

// Sent every HEARTBEAT_INTERVAL_MS so the admin dashboard can show "online - seen just now".
function heartbeat(token, { version, activeCameraCount }) {
  return postJson("/internal/v1/connectors/heartbeat", { version, activeCameraCount }, token);
}

// Pulls this site's camera list (RTSP host/port/credentials + device key) so the
// connector can reconcile which per-camera workers should be running.
function listCameras(token) {
  return getJson("/internal/v1/connectors/cameras", token);
}

// Camera tests queued by the web app, to be run from inside this site LAN.
function listJobs(token) {
  return getJson("/internal/v1/connectors/jobs", token);
}

function postJobResult(token, jobId, result) {
  return postJson(`/internal/v1/connectors/jobs/${encodeURIComponent(jobId)}/result`, result, token);
}

module.exports = { pair, heartbeat, listCameras, listJobs, postJobResult, BACKEND_URL };
