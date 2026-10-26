import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { Role } from "@dbi/api-types";
import { env } from "../config/env";

export interface TokenPayload {
  id: string;
  email: string;
  role: Role;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(password, salt);
}

export async function comparePassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function signAccessToken(payload: TokenPayload): string {
  return jwt.sign(payload, env.jwtAccessSecret, { expiresIn: "7d" });
}

export function verifyAccessToken(token: string): TokenPayload | null {
  try {
    return jwt.verify(token, env.jwtAccessSecret) as TokenPayload;
  } catch {
    return null;
  }
}
