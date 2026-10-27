import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { workerView } from "../components/common/workerStatus";

describe("Worker status", () => {
  it("never shows a stale worker as online", () => {
    const v = workerView({ status: "ONLINE", lastHeartbeatAt: new Date().toISOString(), isStale: true });
    assert.equal(v.label, "STALE");
  });

  it("shows a fresh worker as online", () => {
    const v = workerView({ status: "ONLINE", lastHeartbeatAt: new Date().toISOString(), isStale: false });
    assert.equal(v.label, "ONLINE");
  });

  it("says never when there is no heartbeat", () => {
    assert.equal(workerView({ status: "OFFLINE", lastHeartbeatAt: null, isStale: true }).age, "never");
  });
});
