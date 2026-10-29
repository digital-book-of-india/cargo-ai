import crypto from "crypto";

// Short-lived "do this from inside the site LAN" jobs. The backend cannot reach a camera's
// private IP, so the Connector on that LAN does the work and reports back:
//   PROBE    - is this camera's stream reachable (and are the login/path right)?
//   WEBRTC   - answer a browser's WebRTC offer with a go2rtc stream of this camera
//   DISCOVER - which channels does this recorder (NVR/DVR) offer, with a thumbnail of each?
// Held in memory on purpose: a job only lives for seconds to a couple of minutes, and a lost job
// just surfaces as a timeout the user can retry.
export type JobType = "PROBE" | "DISCOVER" | "WEBRTC";
export type JobResult = Record<string, unknown>;

export interface Job {
  id: string;
  connectorId: string;
  cameraId: string;
  type: JobType;
  streamUrl: string;
  payload: string | null;
  delivered: boolean;
  result: JobResult | null;
  createdAt: number;
}

const JOB_TTL_MS = 3 * 60 * 1000;
const jobs = new Map<string, Job>();

function sweep(): void {
  const cutoff = Date.now() - JOB_TTL_MS;
  for (const [id, job] of jobs) if (job.createdAt < cutoff) jobs.delete(id);
}

export function enqueueJob(
  connectorId: string,
  cameraId: string,
  type: JobType,
  streamUrl: string,
  payload: string | null = null
): string {
  sweep();
  const id = crypto.randomUUID();
  jobs.set(id, { id, connectorId, cameraId, type, streamUrl, payload, delivered: false, result: null, createdAt: Date.now() });
  return id;
}

// Hands each pending job to its connector exactly once.
export function takePendingJobs(connectorId: string) {
  const out: { jobId: string; type: JobType; cameraId: string; streamUrl: string; payload: string | null }[] = [];
  for (const job of jobs.values()) {
    if (job.connectorId !== connectorId || job.delivered || job.result) continue;
    job.delivered = true;
    out.push({ jobId: job.id, type: job.type, cameraId: job.cameraId, streamUrl: job.streamUrl, payload: job.payload });
  }
  return out;
}

export function completeJob(connectorId: string, jobId: string, result: JobResult): boolean {
  const job = jobs.get(jobId);
  if (!job || job.connectorId !== connectorId) return false;
  job.result = result;
  return true;
}

export function peekJob(jobId: string): Job | undefined {
  return jobs.get(jobId);
}

// Waits for a job's result (used by PROBE, which the owner app waits on directly).
export async function waitForJob(jobId: string, timeoutMs: number): Promise<JobResult | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const job = jobs.get(jobId);
    if (!job) return null;
    if (job.result) {
      jobs.delete(jobId);
      return job.result;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  jobs.delete(jobId);
  return null;
}
