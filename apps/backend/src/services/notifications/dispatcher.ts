import { Types } from "mongoose";
import { NotificationModel } from "../../models";
import type { INotificationDocument } from "../../models";

// Delivery with retry, exponential backoff and a dead-letter state. Delivery is idempotent: a
// notification is claimed with a conditional update, so two sweepers (or a retry racing the
// first attempt) never deliver it twice.

export type ChannelHandler = (notification: INotificationDocument) => Promise<void>;

// In-app: the stored row IS the notification the person sees, so delivering means marking it
// sent. Email, webhook and push handlers plug in here later; a handler throws to signal failure.
// The table lives on globalThis so every copy of this module (the server and the test runner can load
// it twice) sees the same handlers.
const registry = globalThis as unknown as { __dbiChannelHandlers?: Record<string, ChannelHandler> };
const handlers: Record<string, ChannelHandler> = (registry.__dbiChannelHandlers ??= {
  IN_APP: async () => undefined,
});

export function setChannelHandler(channel: string, handler: ChannelHandler | null): void {
  if (handler) handlers[channel] = handler;
  else if (channel === "IN_APP") handlers[channel] = async () => undefined;
  else delete handlers[channel];
}

export const MAX_ATTEMPTS = 5;
// wait before attempt 2, 3, 4, 5 (seconds)
export const BACKOFF_SECONDS = [60, 300, 1800, 7200];
const CLAIM_SECONDS = 300; // a claimed notification is invisible to other sweepers for this long

export function nextAttemptDelaySeconds(attemptsSoFar: number): number {
  return BACKOFF_SECONDS[Math.min(attemptsSoFar - 1, BACKOFF_SECONDS.length - 1)];
}

export interface DispatchResult {
  delivered: number;
  retryScheduled: number;
  deadLettered: number;
}

async function processOne(id: Types.ObjectId, now: Date, result: DispatchResult): Promise<void> {
  // claim: only one worker gets the notification, and it counts as an attempt
  const claimed = await NotificationModel.findOneAndUpdate(
    { _id: id, status: "PENDING", $or: [{ nextAttemptAt: null }, { nextAttemptAt: { $lte: now } }] },
    { $inc: { attempts: 1 }, $set: { nextAttemptAt: new Date(now.getTime() + CLAIM_SECONDS * 1000) } },
    { new: true }
  );
  if (!claimed) return;

  const handler = handlers[claimed.channel];
  try {
    if (!handler) throw new Error("NO_CHANNEL_HANDLER");
    await handler(claimed);
    await NotificationModel.updateOne(
      { _id: claimed._id, status: "PENDING" },
      { $set: { status: "SENT", sentAt: new Date(), nextAttemptAt: null }, $unset: { lastErrorCode: 1 } }
    );
    result.delivered++;
  } catch (err) {
    const code = (err instanceof Error ? err.message : "DELIVERY_FAILED").slice(0, 100);
    if (claimed.attempts >= MAX_ATTEMPTS) {
      await NotificationModel.updateOne(
        { _id: claimed._id, status: "PENDING" },
        { $set: { status: "FAILED", nextAttemptAt: null, lastErrorCode: code } }
      );
      result.deadLettered++;
    } else {
      const delay = nextAttemptDelaySeconds(claimed.attempts);
      await NotificationModel.updateOne(
        { _id: claimed._id, status: "PENDING" },
        { $set: { nextAttemptAt: new Date(now.getTime() + delay * 1000), lastErrorCode: code } }
      );
      result.retryScheduled++;
    }
  }
}

// First attempt right after the notifications were created.
export async function dispatchByIds(ids: Types.ObjectId[], now = new Date()): Promise<DispatchResult> {
  const result: DispatchResult = { delivered: 0, retryScheduled: 0, deadLettered: 0 };
  for (const id of ids) await processOne(id, now, result);
  return result;
}

// The sweep that picks up retries that are due. Run it every minute (npm run job:notifications).
export async function dispatchDue(now = new Date(), batchSize = 200): Promise<DispatchResult> {
  const due = await NotificationModel.find({
    status: "PENDING",
    $or: [{ nextAttemptAt: null }, { nextAttemptAt: { $lte: now } }],
  })
    .sort({ createdAt: 1 })
    .limit(batchSize)
    .select("_id");
  const result: DispatchResult = { delivered: 0, retryScheduled: 0, deadLettered: 0 };
  for (const row of due) await processOne(row._id, now, result);
  return result;
}
