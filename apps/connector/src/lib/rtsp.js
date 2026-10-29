const net = require("net");
const crypto = require("crypto");

// A minimal RTSP client: just enough to ask a camera for its stream (OPTIONS, then DESCRIBE with
// the camera's login - Digest or Basic) and see what it answers. This tells "wrong password"
// (401) apart from "no such channel/path" (404) apart from a working stream (200 + video in the
// SDP), which a plain port check cannot. It talks like ffmpeg/VLC do: one connection, OPTIONS
// first. When the camera gives no usable answer, `error` says why (TIMEOUT, ECONNRESET, ...).
const md5 = (s) => crypto.createHash("md5").update(s).digest("hex");

function parseUrl(streamUrl) {
  const u = new URL(streamUrl);
  const port = Number(u.port) || 554;
  const pathAndQuery = `${u.pathname}${u.search}`;
  return {
    host: u.hostname,
    port,
    user: decodeURIComponent(u.username || ""),
    pass: decodeURIComponent(u.password || ""),
    pathAndQuery,
    // The request URI never carries the credentials.
    uri: `rtsp://${u.hostname}:${port}${pathAndQuery}`,
  };
}

// One TCP connection that can carry several request/response pairs.
class Session {
  constructor(host, port, timeoutMs) {
    this.host = host;
    this.port = port;
    this.timeoutMs = timeoutMs;
    this.buf = Buffer.alloc(0);
    this.waiter = null;
    this.failure = null; // why the connection is unusable: TIMEOUT, ECONNRESET, CLOSED, ...
    this.sock = null;
  }

  open() {
    return new Promise((resolve) => {
      const sock = new net.Socket();
      this.sock = sock;
      sock.setTimeout(this.timeoutMs);
      sock.once("connect", () => resolve(true));
      sock.on("data", (chunk) => {
        this.buf = Buffer.concat([this.buf, chunk]);
        this.pump();
      });
      sock.on("error", (err) => {
        this.fail(err.code || "ERROR");
        resolve(false);
      });
      sock.on("timeout", () => {
        this.fail("TIMEOUT");
        sock.destroy();
        resolve(false);
      });
      sock.on("close", () => this.fail("CLOSED"));
      sock.connect(this.port, this.host);
    });
  }

  fail(code) {
    if (!this.failure) this.failure = code;
    if (this.waiter) {
      const w = this.waiter;
      this.waiter = null;
      w(null);
    }
  }

  // Takes one complete response off the buffer, or null if it has not all arrived yet.
  parse() {
    const end = this.buf.indexOf("\r\n\r\n");
    if (end === -1) return null;
    const head = this.buf.slice(0, end).toString("latin1").split("\r\n");
    const m = /^RTSP\/\d\.\d\s+(\d{3})/.exec(head[0] || "");
    if (!m) {
      // Something that is not RTSP (an HTTP page, a banner...): keep a short, printable hint.
      const raw = head[0].replace(/[^\x20-\x7e]/g, "?").slice(0, 40);
      this.buf = Buffer.alloc(0);
      return { status: null, headers: {}, body: "", raw };
    }
    const headers = {};
    for (const line of head.slice(1)) {
      const i = line.indexOf(":");
      if (i === -1) continue;
      const k = line.slice(0, i).trim().toLowerCase();
      (headers[k] = headers[k] || []).push(line.slice(i + 1).trim());
    }
    const length = Number((headers["content-length"] || ["0"])[0]) || 0;
    const bodyStart = end + 4;
    if (this.buf.length - bodyStart < length) return null; // wait for the rest of the SDP
    const body = this.buf.slice(bodyStart, bodyStart + length).toString("utf8");
    this.buf = this.buf.slice(bodyStart + length);
    return { status: Number(m[1]), headers, body };
  }

  pump() {
    if (!this.waiter) return;
    const res = this.parse();
    if (res) {
      const w = this.waiter;
      this.waiter = null;
      w(res);
    }
  }

  // Sends a request and resolves with the response, or null if the connection failed first.
  send(request) {
    return new Promise((resolve) => {
      if (this.failure) return resolve(null);
      this.waiter = resolve;
      this.sock.write(request, (err) => {
        if (err) this.fail(err.code || "WRITE_FAILED");
      });
      this.pump(); // a response may already be buffered
    });
  }

  close() {
    if (this.sock) this.sock.destroy();
  }
}

function request(method, uri, cseq, authorization) {
  return (
    `${method} ${uri} RTSP/1.0\r\nCSeq: ${cseq}\r\nUser-Agent: TheaftConnector\r\n` +
    (method === "DESCRIBE" ? "Accept: application/sdp\r\n" : "") +
    (authorization ? `Authorization: ${authorization}\r\n` : "") +
    "\r\n"
  );
}

function digestHeader(challenge, user, pass, uri) {
  const p = {};
  for (const m of challenge.matchAll(/(\w+)=(?:"([^"]*)"|([^,\s]*))/g)) p[m[1].toLowerCase()] = m[2] !== undefined ? m[2] : m[3];
  const ha1 = md5(`${user}:${p.realm}:${pass}`);
  const ha2 = md5(`DESCRIBE:${uri}`);
  let response;
  let extra = "";
  if ((p.qop || "").split(",").map((q) => q.trim()).includes("auth")) {
    const nc = "00000001";
    const cnonce = crypto.randomBytes(8).toString("hex");
    response = md5(`${ha1}:${p.nonce}:${nc}:${cnonce}:auth:${ha2}`);
    extra = `, qop=auth, nc=${nc}, cnonce="${cnonce}"`;
  } else {
    response = md5(`${ha1}:${p.nonce}:${ha2}`);
  }
  return (
    `Digest username="${user}", realm="${p.realm}", nonce="${p.nonce}", uri="${uri}", response="${response}"` +
    (p.opaque ? `, opaque="${p.opaque}"` : "") +
    extra
  );
}

function authorizationFor(wwwAuthenticate, user, pass, uri) {
  const digest = wwwAuthenticate.find((h) => /^digest/i.test(h));
  if (digest) return digestHeader(digest, user, pass, uri);
  if (wwwAuthenticate.some((h) => /^basic/i.test(h))) {
    return `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;
  }
  return null;
}

// Asks a stream URL for its description, logging in if the camera asks.
//   -> { status, hasVideo, error?, raw? }
// status: the final RTSP status (200 works, 401 wrong login, 404 no such path) or null when the
// camera gave no RTSP answer; then `error` is why (TIMEOUT, ECONNRESET, CLOSED, NOT_RTSP, ...).
async function describe(streamUrl, timeoutMs = 4000) {
  let target;
  try {
    target = parseUrl(streamUrl);
  } catch {
    return { status: null, hasVideo: false, error: "BAD_URL" };
  }

  let session = new Session(target.host, target.port, timeoutMs);
  try {
    if (!(await session.open())) return { status: null, hasVideo: false, error: session.failure || "CONNECT_FAILED" };

    // Like ffmpeg and VLC: OPTIONS first. Its answer does not matter; some cameras simply
    // behave better once the session has started this way.
    await session.send(request("OPTIONS", `rtsp://${target.host}:${target.port}/`, 1));
    let res = session.failure ? null : await session.send(request("DESCRIBE", target.uri, 2));

    if (res && res.status === 401) {
      const auth = target.user ? authorizationFor(res.headers["www-authenticate"] || [], target.user, target.pass, target.uri) : null;
      if (!auth) return { status: 401, hasVideo: false };
      res = await session.send(request("DESCRIBE", target.uri, 3, auth));
      if (!res) {
        // Some cameras hang up right after the 401: log in again on a fresh connection.
        session.close();
        session = new Session(target.host, target.port, timeoutMs);
        if (!(await session.open())) return { status: null, hasVideo: false, error: session.failure || "CONNECT_FAILED" };
        res = await session.send(request("DESCRIBE", target.uri, 3, auth));
      }
    }

    if (!res) return { status: null, hasVideo: false, error: session.failure || "NO_RESPONSE" };
    if (res.status === null) return { status: null, hasVideo: false, error: "NOT_RTSP", raw: res.raw };
    return { status: res.status, hasVideo: res.status === 200 && /^m=video/m.test(res.body) };
  } finally {
    session.close();
  }
}

module.exports = { describe, parseUrl };
