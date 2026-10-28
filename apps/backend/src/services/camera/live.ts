// Live view without any streaming server: the worker on the site PC uploads JPEG frames and the
// owner app polls for the latest one (about 1 frame per second while someone is watching, one
// every minute otherwise so the camera card always has a recent still).
//
// Frames are kept in memory only - they are never written to disk or the database. A restart
// of the backend just means "no picture yet" until the worker uploads the next one.
const LIVE_WINDOW_MS = 30 * 1000; // a "watching" request keeps fast uploads going this long

const liveUntil = new Map<string, number>();
const frames = new Map<string, { jpeg: Buffer; at: number }>();

export function requestLive(cameraId: string): number {
  const until = Date.now() + LIVE_WINDOW_MS;
  liveUntil.set(cameraId, until);
  return until;
}

// Which of these cameras currently have a viewer (the worker uploads fast frames only for these).
export function wantedLive(cameraIds: string[]): string[] {
  const now = Date.now();
  const out: string[] = [];
  for (const id of cameraIds) {
    const until = liveUntil.get(id);
    if (until === undefined) continue;
    if (until > now) out.push(id);
    else liveUntil.delete(id);
  }
  return out;
}

export function storeFrame(cameraId: string, jpeg: Buffer): void {
  frames.set(cameraId, { jpeg, at: Date.now() });
}

export function getFrame(cameraId: string): { jpeg: Buffer; at: number } | null {
  return frames.get(cameraId) ?? null;
}

export function dropFrame(cameraId: string): void {
  frames.delete(cameraId);
  liveUntil.delete(cameraId);
}
