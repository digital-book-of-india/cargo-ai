import { env } from "../config/env";

// Structured logging: one JSON object per line on stdout/stderr, so a log service can index the
// fields. Never pass secrets, request bodies, query strings or tokens to the logger.

type Level = "debug" | "info" | "warn" | "error";
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function threshold(): number {
  const configured = (process.env.LOG_LEVEL ?? "").toLowerCase() as Level;
  if (configured in ORDER) return ORDER[configured];
  return env.nodeEnv === "test" ? Infinity : ORDER.info; // tests stay quiet unless asked
}

const pretty = (process.env.LOG_FORMAT ?? (env.nodeEnv === "production" ? "json" : "pretty")) === "pretty";

function write(level: Level, msg: string, fields: Record<string, unknown>): void {
  if (ORDER[level] < threshold()) return;
  const stream = level === "error" || level === "warn" ? process.stderr : process.stdout;
  if (pretty) {
    const extra = Object.keys(fields).length ? " " + JSON.stringify(fields) : "";
    stream.write(`${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} ${msg}${extra}\n`);
  } else {
    stream.write(JSON.stringify({ ts: new Date().toISOString(), level, msg, ...fields }) + "\n");
  }
}

// An Error becomes name, message and stack (stack only outside production, to keep logs small).
export function errorFields(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    return { errName: err.name, errMessage: err.message, ...(env.nodeEnv === "production" ? {} : { stack: err.stack }) };
  }
  return { errMessage: String(err) };
}

export const logger = {
  debug: (msg: string, fields: Record<string, unknown> = {}) => write("debug", msg, fields),
  info: (msg: string, fields: Record<string, unknown> = {}) => write("info", msg, fields),
  warn: (msg: string, fields: Record<string, unknown> = {}) => write("warn", msg, fields),
  error: (msg: string, fields: Record<string, unknown> = {}) => write("error", msg, fields),
};
