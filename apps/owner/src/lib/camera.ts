import type { Camera, CameraStatus } from "@/types";

/** What the screen shows: the stored status, corrected for how recently the camera reported. */
export type DisplayStatus = CameraStatus | "DEGRADED";

export function displayStatus(camera: Pick<Camera, "status" | "effectiveStatus">): DisplayStatus {
  return camera.effectiveStatus ?? camera.status;
}

// Pure camera helpers. Host, username and password are only ever sent to the API as
// discrete fields: the UI never builds or displays a raw rtsp://user:pass@host URL.

export type HostCheck = { ok: true; value: string } | { ok: false; message: string };

export function checkHost(raw: string): HostCheck {
  const value = raw.trim();
  if (!value) return { ok: false, message: "Enter the camera's IP address or hostname" };
  if (/\s/.test(value)) return { ok: false, message: "The host cannot contain spaces" };
  if (/^rtsps?:\/\//i.test(value)) {
    return { ok: false, message: "Just the IP/host, not the full rtsp:// address" };
  }
  return { ok: true, value };
}

export type PortCheck = { ok: true; value: number | undefined } | { ok: false; message: string };

export function checkPort(raw: string): PortCheck {
  const value = raw.trim();
  if (!value) return { ok: true, value: undefined };
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    return { ok: false, message: "The port must be between 1 and 65535" };
  }
  return { ok: true, value: n };
}

// A connection test only proves the camera's address can be reached. It does not prove that
// pictures are flowing, so the wording never says the camera is "sending video".
export const TEST_RESULT_MESSAGE: Record<DisplayStatus, string> = {
  PENDING_TEST: "This camera has not been tested yet. Run a connection test.",
  ONLINE: "The last connection test reached the camera.",
  DEGRADED: "This camera has not reported recently, so it is not shown as online. Run a connection test.",
  OFFLINE: "No recent report from this camera, so it is not shown as online. Check that it is on, then run a connection test.",
  ERROR: "The camera did not answer the last test. Check the address, username and password.",
};

// "3 minutes ago" style text for lastFrameAt.
export function timeAgo(iso: string, now: Date = new Date()): string {
  const seconds = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}
