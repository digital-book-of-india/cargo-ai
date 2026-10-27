import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import jwt from "jsonwebtoken";
import { Role } from "@dbi/api-types";
import { env } from "../config/env";

export interface TokenPayload {
  id: string;
  email: string;
  role: Role;
  /** the user's tokenVersion when the token was issued; a token from before this field existed counts as 0 */
  tv?: number;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(password, salt);
}

export async function comparePassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function signAccessToken(payload: TokenPayload): string {
  return jwt.sign(payload, env.jwtAccessSecret, { expiresIn: env.accessTokenTtl as jwt.SignOptions["expiresIn"] });
}

// "12h", "30m", "7d", "3600s" -> milliseconds (used for the cookie lifetime, which must match the token)
export function ttlToMs(ttl: string): number {
  const m = /^(\d+)\s*([smhd])$/.exec(ttl.trim());
  if (!m) return 12 * 3600_000;
  return Number(m[1]) * { s: 1000, m: 60_000, h: 3600_000, d: 86_400_000 }[m[2] as "s" | "m" | "h" | "d"];
}

// Compared against when the email is unknown, so an unknown email takes as long as a wrong password.
export const DUMMY_PASSWORD_HASH = bcrypt.hashSync(randomUUID(), 10);

export function verifyAccessToken(token: string): TokenPayload | null {
  try {
    return jwt.verify(token, env.jwtAccessSecret) as TokenPayload;
  } catch {
    return null;
  }
}
