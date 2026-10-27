import crypto from "crypto";
import type { Types } from "mongoose";
import { env } from "../../config/env";
import { AppError } from "../../middleware/errorHandler";
import { getEvidenceStorage } from "./storage";

export type EvidenceKind = "snapshot" | "clip";

const ALLOWED: Record<string, { ext: string; kind: EvidenceKind }> = {
  "image/jpeg": { ext: "jpg", kind: "snapshot" },
  "image/png": { ext: "png", kind: "snapshot" },
  "video/mp4": { ext: "mp4", kind: "clip" },
};

export function kindForContentType(contentType: string): EvidenceKind | null {
  return ALLOWED[contentType]?.kind ?? null;
}

// Light content check so a file cannot claim to be a picture or video while being something else.
export function matchesContentType(contentType: string, data: Buffer): boolean {
  if (contentType === "image/jpeg") return data.length > 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
  if (contentType === "image/png") return data.length > 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (contentType === "video/mp4") return data.length > 12 && data.subarray(4, 8).toString("ascii") === "ftyp";
  return false;
}

// Keys are always generated here: company/site/year/month/random.ext. An inference client can
// never choose where a file goes, and the company is the first path segment.
export function buildObjectKey(companyId: string, siteId: string, contentType: string, now = new Date()): string {
  const meta = ALLOWED[contentType];
  if (!meta) throw new AppError(400, "VALIDATION_ERROR", "Unsupported evidence type.");
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${companyId}/${siteId}/${now.getUTCFullYear()}/${month}/${crypto.randomUUID()}.${meta.ext}`;
}

// True only for a well-formed key that belongs to this company, and to this site when a site is given. Used when an
// event arrives that references evidence the worker uploaded earlier: a file stored for one site cannot be attached
// to an event of another site.
export function keyBelongsToCompany(companyId: string, key: string, siteId?: string): boolean {
  if (typeof key !== "string" || key.length === 0 || key.length > 1024) return false;
  if (key.includes("..") || key.includes("\\") || key.startsWith("/") || key.includes("\0")) return false;
  return key.startsWith(siteId ? `${companyId}/${siteId}/` : `${companyId}/`);
}

export interface SavedEvidence {
  objectKey: string;
  contentType: string;
  kind: EvidenceKind;
  checksum: string;
  sizeBytes: number;
}

export async function saveEvidence(input: {
  companyId: string | Types.ObjectId;
  siteId: string | Types.ObjectId;
  contentType: string;
  data: Buffer;
}): Promise<SavedEvidence> {
  const contentType = input.contentType.toLowerCase();
  const kind = kindForContentType(contentType);
  if (!kind) throw new AppError(400, "VALIDATION_ERROR", "Only JPEG, PNG and MP4 evidence is accepted.");
  if (input.data.length === 0) throw new AppError(400, "VALIDATION_ERROR", "The evidence file is empty.");
  if (input.data.length > env.evidenceMaxUploadBytes) {
    throw new AppError(413, "PAYLOAD_TOO_LARGE", "The evidence file is too large.");
  }
  if (!matchesContentType(contentType, input.data)) {
    throw new AppError(400, "VALIDATION_ERROR", "The file content does not match its type.");
  }

  const objectKey = buildObjectKey(String(input.companyId), String(input.siteId), contentType);
  await getEvidenceStorage().put(objectKey, input.data);
  return {
    objectKey,
    contentType,
    kind,
    checksum: crypto.createHash("sha256").update(input.data).digest("hex"),
    sizeBytes: input.data.length,
  };
}
