const { BACKEND_URL } = require("./config");

async function postJson(path, body, token) {
  const res = await fetch(`${BACKEND_URL}${path}`, {
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

module.exports = { pair, heartbeat, listCameras, BACKEND_URL };
