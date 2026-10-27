import { env } from "../../config/env";
import { AuditLogModel, CargoEventModel, EventHistoryModel, NotificationModel } from "../../models";
import { retentionOverrides } from "../settings/companySettings";
import { getEvidenceStorage } from "../evidence/storage";

export interface RetentionResult {
  cutoff: Date;
  eventsPurged: number;
  filesDeleted: number;
  filesMissing: number;
}

// Evidence of an event nobody has dealt with yet (open, acknowledged, in review, escalated) is kept for longer, so a
// reviewer who is late still sees the picture. It is never kept forever: after this many times the retention period it
// is deleted whatever the status. Resolved and dismissed events lose their evidence at the normal period.
export const UNRESOLVED_RETENTION_FACTOR = 2;
const FINISHED_STATUSES = ["resolved", "false_positive"];
const UNRESOLVED_STATUSES = ["open", "acknowledged", "in_review", "escalated"];

export function retentionCutoff(now: Date, retentionDays: number): Date {
  return new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
}

export interface HousekeepingResult {
  notificationsDeleted: number;
  auditLogsDeleted: number;
}

// Deletes old delivery records and old audit entries. A notification that was never delivered (PENDING) is kept so
// retries and dead-letter handling still see it. Events and their history are NOT touched here: they are the review
// trail; only the evidence files are purged (see runEvidenceRetention).
export async function runHousekeepingRetention(
  now: Date = new Date(),
  notificationDays: number = env.notificationRetentionDays,
  auditDays: number = env.auditRetentionDays
): Promise<HousekeepingResult> {
  const notifications = await NotificationModel.deleteMany({
    status: { $in: ["SENT", "FAILED"] },
    createdAt: { $lt: retentionCutoff(now, notificationDays) },
  });
  const audit = await AuditLogModel.deleteMany({ createdAt: { $lt: retentionCutoff(now, auditDays) } });
  return { notificationsDeleted: notifications.deletedCount ?? 0, auditLogsDeleted: audit.deletedCount ?? 0 };
}

// Deletes evidence FILES older than the retention period and clears the references. The event
// rows, history and notes stay, so the review trail is kept while the pictures and clips go.
// Safe to run repeatedly: an event is processed once (evidencePurgedAt marks it).
// Per-company retention comes with company settings; until then one platform-wide default applies.
export async function runEvidenceRetention(
  now: Date = new Date(),
  retentionDays: number = env.eventRetentionDays,
  batchSize = 500
): Promise<RetentionResult> {
  const cutoff = retentionCutoff(now, retentionDays);
  const storage = getEvidenceStorage();
  const result: RetentionResult = { cutoff, eventsPurged: 0, filesDeleted: 0, filesMissing: 0 };

  // Companies that set their own retention are handled with their own cutoff; everyone else
  // uses the platform default.
  const overrides = await retentionOverrides();
  const customised = Array.from(overrides.keys());
  const base = { evidencePurgedAt: null, "evidence.0": { $exists: true } };

  // for one set of companies and one period: finished events at the period, unresolved ones at the longer limit
  const due = (companyFilter: Record<string, unknown>, days: number) => ({
    ...companyFilter,
    $or: [
      { status: { $in: FINISHED_STATUSES }, occurredAt: { $lt: retentionCutoff(now, days) } },
      { status: { $in: UNRESOLVED_STATUSES }, occurredAt: { $lt: retentionCutoff(now, days * UNRESOLVED_RETENTION_FACTOR) } },
    ],
  });

  const events = await CargoEventModel.find({
    ...base,
    $or: [
      due({ companyId: { $nin: customised } }, retentionDays),
      ...Array.from(overrides.entries()).map(([companyId, days]) => due({ companyId }, days)),
    ],
  })
    .sort({ occurredAt: 1 })
    .limit(batchSize);

  for (const event of events) {
    const days = overrides.get(event.companyId.toString()) ?? retentionDays;
    for (const item of event.evidence) {
      (await storage.remove(item.objectKey)) ? result.filesDeleted++ : result.filesMissing++;
    }
    const purged = event.evidence.length;
    event.evidence = [];
    event.evidencePurgedAt = now;
    await event.save();
    await EventHistoryModel.create({
      companyId: event.companyId,
      eventId: event._id,
      actorUserId: null,
      action: "EVIDENCE_PURGED",
      fromStatus: event.status,
      toStatus: event.status,
      note: `Evidence deleted after ${days} days`,
      metadata: { files: purged },
    });
    result.eventsPurged++;
  }
  return result;
}
