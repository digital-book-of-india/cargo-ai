const { app } = require("electron");
const { EventEmitter } = require("events");
const api = require("./api");
const cameraSync = require("./cameraSync");
const { HEARTBEAT_INTERVAL_MS } = require("./config");

class Heartbeat extends EventEmitter {
  constructor() {
    super();
    this.timer = null;
  }

  start(getToken, onUnauthorized) {
    this.stop();
    const tick = async () => {
      const token = getToken();
      if (!token) return;
      try {
        await api.heartbeat(token, {
          version: app.getVersion(),
          activeCameraCount: cameraSync.count,
        });
        this.emit("ok");
      } catch (err) {
        if (err.status === 401 || err.status === 404) {
          // Backend no longer recognizes this connector (unpaired/revoked) - force re-pairing.
          this.stop();
          onUnauthorized?.();
          return;
        }
        this.emit("error", err);
      }
    };
    tick();
    this.timer = setInterval(tick, HEARTBEAT_INTERVAL_MS);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

module.exports = new Heartbeat();
