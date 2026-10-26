import jwt from "jsonwebtoken";
import { env } from "../../config/env";

export type EvidenceKind = "snapshot" | "clip";

interface EvidenceTokenPayload {
  eventId: string;
  kind: EvidenceKind;
}

const EVIDENCE_URL_TTL_SECONDS = 10 * 60; // short-lived, access-controlled link

export function signEvidenceUrl(eventId: string, kind: EvidenceKind): { url: string; expiresAt: string } {
  const expiresAt = new Date(Date.now() + EVIDENCE_URL_TTL_SECONDS * 1000);
  const token = jwt.sign({ eventId, kind } as EvidenceTokenPayload, env.jwtAccessSecret, {
    expiresIn: EVIDENCE_URL_TTL_SECONDS,
  });
  return {
    url: `/api/v1/evidence/${encodeURIComponent(eventId)}/${kind}?token=${token}`,
    expiresAt: expiresAt.toISOString(),
  };
}

export function verifyEvidenceToken(token: string): EvidenceTokenPayload | null {
  try {
    return jwt.verify(token, env.jwtAccessSecret) as EvidenceTokenPayload;
  } catch {
    return null;
  }
}
