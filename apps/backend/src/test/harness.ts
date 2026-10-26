import fs from "fs";
import http from "http";
import os from "os";
import path from "path";
import dotenv from "dotenv";
import type { AddressInfo } from "net";

// Integration-test harness. It points the backend at a SEPARATE database whose name must end
// with "_test" and drops that database afterwards, so it can never touch the real data.
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

function testDatabaseUri(): string {
  const base = process.env.MONGODB_URI_TEST || process.env.MONGODB_URI;
  if (!base) throw new Error("MONGODB_URI (or MONGODB_URI_TEST) is not set; cannot run integration tests.");
  const url = new URL(base);
  if (!process.env.MONGODB_URI_TEST) url.pathname = "/cargo_ai_test";
  const dbName = url.pathname.replace(/^\//, "");
  if (!dbName.endsWith("_test")) {
    throw new Error(`Refusing to run integration tests against database "${dbName}" (must end with _test).`);
  }
  return url.toString();
}

process.env.MONGODB_URI = testDatabaseUri();
process.env.NODE_ENV = "test";
// Evidence written by tests goes to a private temp folder that is deleted afterwards.
const evidenceDir = fs.mkdtempSync(path.join(os.tmpdir(), "cargo-ai-evidence-"));
process.env.EVIDENCE_STORAGE_DIR = evidenceDir;
export const TEST_EVIDENCE_DIR = evidenceDir;

export interface TestServer {
  baseUrl: string;
  close: () => Promise<void>;
}

export async function startTestServer(): Promise<TestServer> {
  const { app } = await import("../app");
  const { connectDatabase, disconnectDatabase } = await import("../config/db");
  const mongoose = (await import("mongoose")).default;

  await connectDatabase();
  await mongoose.connection.dropDatabase(); // start from an empty test database

  const server: http.Server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const port = (server.address() as AddressInfo).port;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await mongoose.connection.dropDatabase();
      await disconnectDatabase();
      fs.rmSync(evidenceDir, { recursive: true, force: true });
    },
  };
}

export interface ApiResult<T = any> {
  status: number;
  body: T;
  raw: string;
}

// Posts a small file as multipart form data (used for the evidence upload endpoint).
export async function uploadFile(
  baseUrl: string,
  pathName: string,
  fields: Record<string, string>,
  file: { bytes: Buffer; type: string; name: string },
  headers: Record<string, string> = {}
): Promise<ApiResult> {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  form.append("file", new Blob([file.bytes], { type: file.type }), file.name);
  const res = await fetch(baseUrl + pathName, { method: "POST", headers, body: form });
  const raw = await res.text();
  let body: any = null;
  try {
    body = raw ? JSON.parse(raw) : null;
  } catch {
    body = null;
  }
  return { status: res.status, body, raw };
}

export function createClient(baseUrl: string) {
  async function request(
    method: string,
    pathName: string,
    opts: { token?: string; body?: unknown; headers?: Record<string, string> } = {}
  ): Promise<ApiResult> {
    const headers: Record<string, string> = { ...(opts.headers ?? {}) };
    if (opts.body !== undefined) headers["Content-Type"] = "application/json";
    if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
    const res = await fetch(`${baseUrl}${pathName}`, {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
    const raw = await res.text();
    let body: any = null;
    try {
      body = raw ? JSON.parse(raw) : null;
    } catch {
      body = null;
    }
    return { status: res.status, body, raw };
  }

  return {
    get: (p: string, o?: { token?: string; headers?: Record<string, string> }) => request("GET", p, o),
    post: (p: string, body?: unknown, o?: { token?: string; headers?: Record<string, string> }) =>
      request("POST", p, { ...o, body: body ?? {} }),
    put: (p: string, body?: unknown, o?: { token?: string; headers?: Record<string, string> }) =>
      request("PUT", p, { ...o, body: body ?? {} }),
    patch: (p: string, body?: unknown, o?: { token?: string; headers?: Record<string, string> }) =>
      request("PATCH", p, { ...o, body: body ?? {} }),
    delete: (p: string, o?: { token?: string; headers?: Record<string, string> }) => request("DELETE", p, o),
  };
}
