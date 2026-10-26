import crypto from "crypto";
import { Connector, ConnectorWithPairingCode } from "@dbi/api-types";
import { IConnectorDocument } from "../../models/Connector";
import { env } from "../../config/env";

// Pairing codes are short-lived and human-typed, so they're deliberately low-entropy
// (XXXX-XXXX from an unambiguous alphabet) - the connector token below is the real secret.
const PAIRING_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O, 1/I

export function generatePairingCode(): string {
  const chars = Array.from({ length: 8 }, () => {
    const idx = crypto.randomInt(0, PAIRING_CODE_ALPHABET.length);
    return PAIRING_CODE_ALPHABET[idx];
  });
  return `${chars.slice(0, 4).join("")}-${chars.slice(4).join("")}`;
}

export function pairingCodeExpiry(): Date {
  return new Date(Date.now() + env.connectorPairingCodeTtlMinutes * 60 * 1000);
}

// The connector token itself is a 256-bit random secret, shown to the operator exactly
// once (inside the pairing code exchange response). Only its SHA-256 hash is stored, so a
// stolen database dump can't be used to impersonate a connector.
export function generateConnectorToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

export function hashConnectorToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function isOnline(doc: Pick<IConnectorDocument, "status" | "lastHeartbeatAt">): boolean {
  if (doc.status !== "PAIRED" || !doc.lastHeartbeatAt) return false;
  return Date.now() - doc.lastHeartbeatAt.getTime() <= env.connectorStaleSeconds * 1000;
}

export function sanitizeConnector(doc: IConnectorDocument | any): Connector {
  return {
    id: doc._id.toString(),
    shopId: doc.shopId.toString(),
    name: doc.name,
    status: doc.status,
    online: isOnline(doc),
    lastHeartbeatAt: doc.lastHeartbeatAt ? new Date(doc.lastHeartbeatAt).toISOString() : null,
    lastSeenVersion: doc.lastSeenVersion ?? null,
    activeCameraCount: doc.activeCameraCount ?? 0,
    createdAt: doc.createdAt ? new Date(doc.createdAt).toISOString() : undefined,
  };
}

export function sanitizeConnectorWithPairingCode(doc: IConnectorDocument | any): ConnectorWithPairingCode {
  if (!doc.pairingCode || !doc.pairingCodeExpiresAt) {
    throw new Error("Connector has no active pairing code");
  }
  return {
    ...sanitizeConnector(doc),
    pairingCode: doc.pairingCode,
    pairingCodeExpiresAt: new Date(doc.pairingCodeExpiresAt).toISOString(),
  };
}
