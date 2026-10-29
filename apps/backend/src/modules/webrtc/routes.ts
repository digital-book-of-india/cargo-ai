import { Router, Request, Response, NextFunction } from "express";
import { env } from "../../config/env";
import { authenticate } from "../../middleware/auth";

export const webrtcRouter = Router();

const STUN_ONLY = [{ urls: ["stun:stun.cloudflare.com:3478"] }];
const TURN_CREDENTIAL_TTL_SECONDS = 3600;

// GET /api/v1/webrtc/ice
// ICE servers for the browser's WebRTC connection. With Cloudflare TURN configured it mints a
// short-lived credential per request (the API token never leaves the server); otherwise it
// falls back to STUN only, which works on most home/office networks but not behind strict NAT.
webrtcRouter.get("/ice", authenticate, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    if (!env.cfTurnKeyId || !env.cfTurnApiToken) {
      res.json({ data: { iceServers: STUN_ONLY, turn: false } });
      return;
    }

    const cf = await fetch(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(env.cfTurnKeyId)}/credentials/generate`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${env.cfTurnApiToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ ttl: TURN_CREDENTIAL_TTL_SECONDS }),
      }
    );
    if (!cf.ok) {
      // Never block live view on TURN trouble: STUN still works for most networks.
      res.json({ data: { iceServers: STUN_ONLY, turn: false } });
      return;
    }
    const body = (await cf.json()) as { iceServers?: unknown };
    const turn = Array.isArray(body.iceServers) ? body.iceServers : body.iceServers ? [body.iceServers] : [];
    res.json({ data: { iceServers: [...STUN_ONLY, ...turn], turn: turn.length > 0 } });
  } catch (err) {
    next(err);
  }
});
