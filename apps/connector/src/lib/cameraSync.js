const { EventEmitter } = require("events");
const api = require("./api");
const { CAMERA_SYNC_INTERVAL_MS } = require("./config");

// Polls the backend for this site's camera list and reconciles per-camera workers.
//
// STAGE 1 (this file, today): fetch + diff the camera list, emit events so the tray UI
// can show "N cameras configured". No RTSP/face-recognition/go2rtc workers are started yet.
//
// STAGE 2 (next): on 'camera-added', spawn a worker that pulls RTSP frames, runs face
// recognition, and POSTs attendance detections to /internal/v1/connectors/attendance.
// On 'camera-removed', stop that worker. On a live-view request relayed through the
// heartbeat/signaling channel, start a go2rtc instance for that camera and hand it the
// WebRTC offer. Wire that worker manager in here, subscribed to this emitter, instead of
// rewriting the polling loop.
class CameraSync extends EventEmitter {
  constructor() {
    super();
    this.timer = null;
    this.known = new Map(); // cameraId -> camera record
  }

  start(getToken) {
    this.stop();
    const tick = async () => {
      const token = getToken();
      if (!token) return;
      try {
        const { data } = await api.listCameras(token);
        this._reconcile(data?.items || []);
      } catch (err) {
        this.emit("error", err);
      }
    };
    tick();
    this.timer = setInterval(tick, CAMERA_SYNC_INTERVAL_MS);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  _reconcile(items) {
    const seen = new Set();
    for (const cam of items) {
      seen.add(cam.cameraId);
      if (!this.known.has(cam.cameraId)) {
        this.known.set(cam.cameraId, cam);
        this.emit("camera-added", cam);
      }
    }
    for (const [cameraId, cam] of this.known) {
      if (!seen.has(cameraId)) {
        this.known.delete(cameraId);
        this.emit("camera-removed", cam);
      }
    }
    this.emit("synced", { count: this.known.size });
  }

  get count() {
    return this.known.size;
  }
}

module.exports = new CameraSync();
