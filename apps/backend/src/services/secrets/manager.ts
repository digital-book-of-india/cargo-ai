import crypto from "crypto";
import { Camera } from "@dbi/api-types";
import { ICameraDocument } from "../../models/Camera";
import { env } from "../../config/env";

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

export function encryptSecret(plainText: string): string {
  if (!plainText || typeof plainText !== "string") return "";
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(
    "aes-256-cbc",
    ENCRYPTION_KEY as unknown as crypto.CipherKey,
    iv as unknown as crypto.BinaryLike
  );
  let encrypted = cipher.update(plainText, "utf8", "hex");
  encrypted += cipher.final("hex");
  return `${iv.toString("hex")}:${encrypted}`;
}

export function decryptSecret(cipherText: string): string {
  try {
    if (!cipherText || typeof cipherText !== "string") return "";
    const [ivHex, encrypted] = cipherText.split(":");
    if (!ivHex || !encrypted) return cipherText;
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

  return {
    id: cam._id ? cam._id.toString() : String(cam.id),
    shopId: cam.shopId ? cam.shopId.toString() : String(cam.shopId),
    connectorId: cam.connectorId ? cam.connectorId.toString() : null,
    name: cam.name,
    protocol: cam.protocol,
    status: cam.status,
    lastFrameAt: toIso(cam.lastFrameAt),
    lastHealthAt: toIso(cam.lastHealthAt),
    lastErrorCode: cam.lastErrorCode ?? null,
    createdAt: toIso(cam.createdAt) ?? undefined,
  };
}
