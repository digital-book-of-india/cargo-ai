import jwt from "jsonwebtoken";
import { env } from "../../config/env";

export type EvidenceKind = "snapshot" | "clip";

export interface EvidenceTokenPayload {
  eventId: string; // the event's database id
  kind: EvidenceKind;
  cid: string; // company the link was issued for
  uid?: string; // user the link was issued to (recorded in the access audit)
}

// A link is issued only after the caller was authorised for the event. It is short-lived and
// bound to one event, one kind of file and one company.
export function signEvidenceUrl(
  eventId: string,
  kind: EvidenceKind,
  who: { companyId: string; userId?: string },
  ttlSeconds: number = env.evidenceSignedUrlTtlSeconds
): { url: string; expiresAt: string } {
  const payload: EvidenceTokenPayload = { eventId, kind, cid: who.companyId, uid: who.userId };
  const token = jwt.sign(payload, env.jwtAccessSecret, { expiresIn: ttlSeconds });
  return {
    url: `/api/v1/evidence/${encodeURIComponent(eventId)}/${kind}?token=${token}`,
    expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
  };
}

export function verifyEvidenceToken(token: string): EvidenceTokenPayload | null {
  try {
    return jwt.verify(token, env.jwtAccessSecret) as EvidenceTokenPayload;
  } catch {
    return null; // expired, tampered or malformed
  }
}
