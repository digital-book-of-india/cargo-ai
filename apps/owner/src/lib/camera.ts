import type { CameraStatus } from "@/types";

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

export const TEST_RESULT_MESSAGE: Record<CameraStatus, string> = {
  PENDING_TEST: "Waiting for the monitoring service to test this camera.",
  ONLINE: "The camera is sending video.",
  OFFLINE: "We could not reach the camera. Check that it is on and the address is right.",
  ERROR: "The camera answered with an error. Check the address, username and password.",
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
