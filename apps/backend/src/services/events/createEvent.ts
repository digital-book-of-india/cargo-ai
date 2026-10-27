import { Types } from "mongoose";
import { SEVERITY_RANK, UNMUTABLE_EVENT_TYPES, type CargoEventSeverity, type CargoEventType } from "@dbi/api-types";
import { AppError } from "../../middleware/errorHandler";
import {
  CameraModel,
  CargoEventModel,
  CompanyMemberModel,
  CompanyModel,
  EventHistoryModel,
  NotificationModel,
  SiteModel,
  LoadingSessionModel,
  VisionZoneModel,
} from "../../models";
import type { ICargoEventDocument, IEvidenceItem } from "../../models";
import { can, canAccessSite } from "../authz/permissions";
import { keyBelongsToCompany } from "../evidence/service";
import { getEvidenceStorage } from "../evidence/storage";
import { dispatchByIds } from "../notifications/dispatcher";
import { getCompanySettings } from "../settings/companySettings";
import { defaultSeverity, defaultSummary } from "./transitions";

// The contract between the AI pipeline (Dev 2) and the event workflow (Dev 1).
// companyId is NOT an input: it is derived from the site. `expectedCompanyId` is only a check
// for callers that were also given one (a mismatch is refused, never trusted).
export interface CargoEventInput {
  eventKey: string;
  siteId: string;
  cameraId: string;
  zoneId?: string | null;
  loadingSessionId?: string | null;
  eventType: CargoEventType;
  severity?: CargoEventSeverity;
  summary?: string;
  occurredAt: Date | string;
  payload?: Record<string, unknown>;
  evidence?: { snapshotObjectKey?: string | null; clipObjectKey?: string | null };
  model?: { name?: string; version?: string } | null;
  expectedCompanyId?: string;
  demo?: boolean;
  actorUserId?: string | null; // set for events a person creates by hand
}

export interface CreateCargoEventResult {
  event: ICargoEventDocument;
  created: boolean; // false when this eventKey was already recorded (a retry)
}

const MAX_PAYLOAD_BYTES = 16 * 1024;
const FORBIDDEN_KEY = /(password|passwd|secret|token|credential|rtsp|authorization)/i;

// Event payloads must never carry camera credentials or tokens.
function assertSafePayload(value: unknown, depth = 0): void {
  if (depth > 5 || value === null || typeof value !== "object") return;
  for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_KEY.test(key)) {
      throw new AppError(400, "VALIDATION_ERROR", `The event payload must not contain "${key}".`);
    }
    assertSafePayload(inner, depth + 1);
  }
}

function contentTypeForKey(key: string): string | undefined {
  const lower = key.toLowerCase();
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".mp4")) return "video/mp4";
  return undefined;
}

async function buildEvidence(companyId: string, siteId: string, evidence: CargoEventInput["evidence"]): Promise<IEvidenceItem[]> {
  const items: IEvidenceItem[] = [];
  const entries: Array<["snapshot" | "clip", string | null | undefined]> = [
    ["snapshot", evidence?.snapshotObjectKey],
    ["clip", evidence?.clipObjectKey],
  ];
  for (const [type, key] of entries) {
    if (!key) continue;
    // Only files the server itself stored for this company and site may be referenced.
    if (!keyBelongsToCompany(companyId, key, siteId)) {
      throw new AppError(400, "VALIDATION_ERROR", "Evidence must be uploaded through the evidence endpoint first.");
    }
    if (!(await getEvidenceStorage().exists(key))) {
      throw new AppError(400, "VALIDATION_ERROR", "The referenced evidence file does not exist.");
    }
    items.push({ type, objectKey: key, contentType: contentTypeForKey(key), capturedAt: new Date() });
  }
  return items;
}

// Tells every active member who may review events at this site. In-app only for now.
export async function notifyReviewers(event: ICargoEventDocument): Promise<number> {
  // The company's notification rules decide whether anyone is told. Health events are never muted.
  const rules = (await getCompanySettings(event.companyId.toString())).notificationRules;
  const isHealthNotice = UNMUTABLE_EVENT_TYPES.includes(event.eventType);
  if (!isHealthNotice) {
    if (SEVERITY_RANK[event.severity] < SEVERITY_RANK[rules.inAppMinSeverity]) return 0;
    if (rules.mutedEventTypes.includes(event.eventType)) return 0;
  }

  const members = await CompanyMemberModel.find({ companyId: event.companyId, status: "ACTIVE" }).lean();
  const recipients = members.filter(
    (m) =>
      can(m.role, "events:review") &&
      canAccessSite(m.role, (m.siteIds ?? []).map((id) => id.toString()), event.siteId.toString())
  );
  if (recipients.length === 0) return 0;
  // created as PENDING and handed to the dispatcher, which delivers, retries with backoff and
  // dead-letters. The unique index makes a repeated call harmless.
  const created = await NotificationModel.insertMany(
    recipients.map((m) => ({
      companyId: event.companyId,
      eventId: event._id,
      recipientUserId: m.userId,
      channel: "IN_APP",
      status: "PENDING",
      attempts: 0,
      nextAttemptAt: null,
    })),
    { ordered: false }
  ).catch((err) => {
    // duplicates (already notified) are fine; anything else is a real error
    if ((err as { code?: number }).code === 11000 || (err as { writeErrors?: unknown[] }).writeErrors) {
      return ((err as { insertedDocs?: unknown[] }).insertedDocs ?? []) as Array<{ _id: Types.ObjectId }>;
    }
    throw err;
  });
  await dispatchByIds(created.map((n) => n._id as Types.ObjectId));
  return created.length;
}

export async function createCargoEvent(input: CargoEventInput): Promise<CreateCargoEventResult> {
  if (!input.eventKey || input.eventKey.length > 200) {
    throw new AppError(400, "VALIDATION_ERROR", "eventKey is required (max 200 characters).");
  }
  const occurredAt = new Date(input.occurredAt);
  if (Number.isNaN(occurredAt.getTime())) throw new AppError(400, "VALIDATION_ERROR", "occurredAt is not a valid time.");

  // The company comes from the site, and the camera/zone must belong to that same site.
  const site = Types.ObjectId.isValid(input.siteId) ? await SiteModel.findById(input.siteId) : null;
  if (!site) throw new AppError(404, "NOT_FOUND", "Target site not found for this event.");
  if (input.expectedCompanyId && input.expectedCompanyId !== site.companyId.toString()) {
    throw new AppError(400, "VALIDATION_ERROR", "The site does not belong to the stated company.");
  }
  if (site.status === "ARCHIVED") {
    throw new AppError(422, "BUSINESS_RULE_FAILED", "Events cannot be recorded for an archived site.");
  }
  const company = await CompanyModel.findById(site.companyId).select("status").lean();
  if (!company || company.status !== "ACTIVE") {
    throw new AppError(422, "BUSINESS_RULE_FAILED", "Events cannot be recorded for an inactive company.");
  }
  const companyId = site.companyId.toString();

  const camera = Types.ObjectId.isValid(input.cameraId)
    ? await CameraModel.findOne({ _id: input.cameraId, siteId: site._id, companyId: site.companyId }).select("_id")
    : null;
  if (!camera) throw new AppError(400, "VALIDATION_ERROR", "cameraId does not belong to the target site.");

  let zoneId: Types.ObjectId | null = null;
  if (input.zoneId) {
    const zone = Types.ObjectId.isValid(input.zoneId)
      ? await VisionZoneModel.findOne({ _id: input.zoneId, siteId: site._id }).select("_id")
      : null;
    if (!zone) throw new AppError(400, "VALIDATION_ERROR", "zoneId does not belong to the target site.");
    zoneId = zone._id as Types.ObjectId;
  }

  let loadingSessionId: Types.ObjectId | null = null;
  if (input.loadingSessionId) {
    const session = Types.ObjectId.isValid(input.loadingSessionId)
      ? await LoadingSessionModel.findOne({ _id: input.loadingSessionId, siteId: site._id, companyId: site.companyId }).select("_id")
      : null;
    if (!session) throw new AppError(400, "VALIDATION_ERROR", "loadingSessionId does not belong to the target site.");
    loadingSessionId = session._id as Types.ObjectId;
  }

  const payload = input.payload ?? {};
  assertSafePayload(payload);
  if (Buffer.byteLength(JSON.stringify(payload), "utf8") > MAX_PAYLOAD_BYTES) {
    throw new AppError(413, "PAYLOAD_TOO_LARGE", "The event payload is too large.");
  }

  // Idempotent: the same key for the same company returns the stored event and changes nothing.
  const existing = await CargoEventModel.findOne({ companyId: site.companyId, eventKey: input.eventKey });
  if (existing) return { event: existing, created: false };

  const evidence = await buildEvidence(companyId, site._id.toString(), input.evidence);

  let event: ICargoEventDocument;
  try {
    event = await CargoEventModel.create({
      companyId: site.companyId,
      siteId: site._id,
      cameraId: camera._id,
      zoneId,
      loadingSessionId,
      eventKey: input.eventKey,
      eventType: input.eventType,
      severity: input.severity ?? defaultSeverity(input.eventType),
      status: "open",
      summary: (input.summary ?? defaultSummary(input.eventType)).slice(0, 500),
      payload,
      occurredAt,
      detector: input.model ?? null,
      evidence,
      demo: Boolean(input.demo),
    });
  } catch (err) {
    // Two retries raced: the unique (companyId, eventKey) index lets exactly one win.
    if (typeof err === "object" && err !== null && (err as { code?: number }).code === 11000) {
      const winner = await CargoEventModel.findOne({ companyId: site.companyId, eventKey: input.eventKey });
      if (winner) return { event: winner, created: false };
    }
    throw err;
  }

  await EventHistoryModel.create({
    companyId: site.companyId,
    eventId: event._id,
    actorUserId: input.actorUserId && Types.ObjectId.isValid(input.actorUserId) ? input.actorUserId : null,
    action: "CREATED",
    fromStatus: null,
    toStatus: "open",
    metadata: { eventType: input.eventType },
  });
  await notifyReviewers(event);

  return { event, created: true };
}
