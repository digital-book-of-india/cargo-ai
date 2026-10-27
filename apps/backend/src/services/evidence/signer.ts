import crypto from "crypto";
import jwt from "jsonwebtoken";
import { env } from "../../config/env";

export type EvidenceKind = "snapshot" | "clip";

export interface EvidenceTokenPayload {
  eventId: string; // the event's database id
  kind: EvidenceKind;
  cid: string; // company the link was issued for
  uid?: string; // user the link was issued to (recorded in the access audit, and checked again when the link is used)
  sup?: boolean; // issued to a platform administrator through the audited support workflow
}

// Evidence links are signed with their own key (derived from the access secret, so there is nothing new to configure)
// and carry an audience. A sign-in token can therefore never be used as an evidence link, nor the other way round.
const LINK_KEY = crypto.createHmac("sha256", env.jwtAccessSecret).update("evidence-link-v1").digest();
const AUDIENCE = "evidence";
const ISSUER = "cargo-api";

// A link is issued only after the caller was authorised for the event. It is short-lived and
// bound to one event, one kind of file and one company.
export function signEvidenceUrl(
  eventId: string,
  kind: EvidenceKind,
  who: { companyId: string; userId?: string; support?: boolean },
  ttlSeconds: number = env.evidenceSignedUrlTtlSeconds
): { url: string; expiresAt: string } {
  const payload: EvidenceTokenPayload = { eventId, kind, cid: who.companyId, uid: who.userId, ...(who.support ? { sup: true } : {}) };
  const token = jwt.sign(payload, LINK_KEY, { expiresIn: ttlSeconds, audience: AUDIENCE, issuer: ISSUER });
  return {
    url: `/api/v1/evidence/${encodeURIComponent(eventId)}/${kind}?token=${token}`,
    expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
  };
}

export function verifyEvidenceToken(token: string): EvidenceTokenPayload | null {
  try {
    return jwt.verify(token, LINK_KEY, { audience: AUDIENCE, issuer: ISSUER }) as EvidenceTokenPayload;
  } catch {
    return null; // expired, tampered, wrong audience or malformed
  }
}
