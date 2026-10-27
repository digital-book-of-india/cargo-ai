import crypto from "crypto";
import { Camera } from "@dbi/api-types";
import { ICameraDocument } from "../../models/Camera";
import { env } from "../../config/env";
import { computeEffectiveCameraStatus } from "../../utils/adminHelpers";

const ENCRYPTION_KEY = crypto
  .createHash("sha256")
  .update(env.cameraSecretEncryptionKey)
  .digest(); // 32 bytes key
const IV_LENGTH = 16;

export function buildRtspUrl(fields: {
  protocol: "RTSP" | "ONVIF";
  host: string;
  port?: number;
  username?: string;
  password?: string;
  path?: string;
}): string {
  const scheme = fields.protocol === "ONVIF" ? "http" : "rtsp";
  const port = fields.port ?? (fields.protocol === "ONVIF" ? 80 : 554);
  const auth =
    fields.username && fields.password
      ? `${encodeURIComponent(fields.username)}:${encodeURIComponent(fields.password)}@`
      : "";
  const rawPath = fields.path?.trim() || "/stream1";
  const path = rawPath.startsWith("/") ? rawPath : `/${rawPath}`;
  return `${scheme}://${auth}${fields.host}:${port}${path}`;
}

// New secrets use AES-256-GCM: a changed or truncated value is detected and refused. "v2:<iv>:<tag>:<data>" (hex).
// Secrets written before that (AES-256-CBC, "<iv>:<data>") can still be read until migration 20261101-105 re-encrypts them.
const GCM_PREFIX = "v2:";
const GCM_IV_LENGTH = 12;
const LEGACY_SECRET = /^[0-9a-f]{32}:[0-9a-f]+$/i;

export function isLegacySecret(value: string): boolean {
  return typeof value === "string" && LEGACY_SECRET.test(value);
}

export function encryptSecret(plainText: string): string {
  if (!plainText || typeof plainText !== "string") return "";
  const iv = crypto.randomBytes(GCM_IV_LENGTH);
  const cipher = crypto.createCipheriv(
    "aes-256-gcm",
    ENCRYPTION_KEY as unknown as crypto.CipherKey,
    iv as unknown as crypto.BinaryLike
  ) as crypto.CipherGCM;
  const data = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  return `${GCM_PREFIX}${iv.toString("hex")}:${cipher.getAuthTag().toString("hex")}:${data.toString("hex")}`;
}

// Anything that is not a value we encrypted gives "" (never the input itself): a plain-text value in the secret column
// is not trusted as a stream address.
export function decryptSecret(cipherText: string): string {
  try {
    if (!cipherText || typeof cipherText !== "string") return "";
    if (cipherText.startsWith(GCM_PREFIX)) {
      const [ivHex, tagHex, dataHex] = cipherText.slice(GCM_PREFIX.length).split(":");
      if (!ivHex || !tagHex || !dataHex) return "";
      const decipher = crypto.createDecipheriv(
        "aes-256-gcm",
        ENCRYPTION_KEY as unknown as crypto.CipherKey,
        Buffer.from(ivHex, "hex") as unknown as crypto.BinaryLike
      ) as crypto.DecipherGCM;
      decipher.setAuthTag(Buffer.from(tagHex, "hex"));
      return Buffer.concat([decipher.update(Buffer.from(dataHex, "hex")), decipher.final()]).toString("utf8");
    }
    if (!isLegacySecret(cipherText)) return "";
    const [ivHex, encrypted] = cipherText.split(":");
    const iv = Buffer.from(ivHex, "hex");
    const decipher = crypto.createDecipheriv(
      "aes-256-cbc",
      ENCRYPTION_KEY as unknown as crypto.CipherKey,
      iv as unknown as crypto.BinaryLike
    );
    let decrypted = decipher.update(encrypted, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  } catch {
    return "";
  }
}

export function sanitizeCamera(cam: ICameraDocument | any): Camera {
  const toIso = (val: any): string | null => {
    if (!val) return null;
    if (val instanceof Date) return val.toISOString();
    try {
      const d = new Date(val);
      return isNaN(d.getTime()) ? null : d.toISOString();
    } catch {
      return null;
    }
  };

  // Truthful status: a camera that has not reported recently is not shown as online.
  const { effectiveStatus, isStale } = computeEffectiveCameraStatus(
    cam.status,
    cam.lastHealthAt,
    cam.lastFrameAt,
    env.cameraStaleSeconds
  );

  return {
    id: cam._id ? cam._id.toString() : String(cam.id),
    companyId: cam.companyId ? cam.companyId.toString() : String(cam.companyId),
    siteId: cam.siteId ? cam.siteId.toString() : String(cam.siteId),
    name: cam.name,
    protocol: cam.protocol,
    status: cam.status,
    effectiveStatus,
    isStale,
    lastFrameAt: toIso(cam.lastFrameAt),
    lastHealthAt: toIso(cam.lastHealthAt),
    lastErrorCode: cam.lastErrorCode ?? null,
    createdAt: toIso(cam.createdAt) ?? undefined,
  };
}
