import { env } from "../../config/env";
import { CargoEventModel, EventHistoryModel } from "../../models";
import { retentionOverrides } from "../settings/companySettings";
import { getEvidenceStorage } from "../evidence/storage";

export interface RetentionResult {
  cutoff: Date;
  eventsPurged: number;
  filesDeleted: number;
  filesMissing: number;
}

export function retentionCutoff(now: Date, retentionDays: number): Date {
  return new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
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

  const events = await CargoEventModel.find({
    ...base,
    $or: [
      { companyId: { $nin: customised }, occurredAt: { $lt: cutoff } },
      ...Array.from(overrides.entries()).map(([companyId, days]) => ({
        companyId,
        occurredAt: { $lt: retentionCutoff(now, days) },
      })),
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
