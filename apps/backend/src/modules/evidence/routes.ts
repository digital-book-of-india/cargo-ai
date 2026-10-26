import { Router, Request, Response, NextFunction } from "express";
import path from "path";
import fs from "fs";
import { SecurityEventModel } from "../../models";
import { verifyEvidenceToken, EvidenceKind } from "../../services/evidence/signer";

export const evidenceRouter = Router();

const STORAGE_ROOT = path.resolve(process.cwd(), process.env.EVIDENCE_STORAGE_DIR || "storage/evidence");

function safeResolve(objectKey: string): string | null {
  const resolved = path.resolve(STORAGE_ROOT, objectKey);
  if (resolved !== STORAGE_ROOT && !resolved.startsWith(STORAGE_ROOT + path.sep)) return null; // path traversal guard
  return resolved;
}

// GET /api/v1/evidence/:eventId/:kind?token=...
// Short-lived signed link. No cookie/session needed, so <img>/<video> tags can load it directly.
evidenceRouter.get(
  "/:eventId/:kind",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const kind = req.params.kind as EvidenceKind;
      if (kind !== "snapshot" && kind !== "clip") {
        res.status(400).json({
          error: { code: "VALIDATION_ERROR", message: "kind must be snapshot or clip", requestId: req.requestId },
        });
        return;
      }

      const token = String(req.query.token ?? "");
      const payload = token ? verifyEvidenceToken(token) : null;
      if (!payload || payload.eventId !== req.params.eventId || payload.kind !== kind) {
        res.status(401).json({
          error: { code: "UNAUTHORIZED", message: "Invalid or expired evidence link.", requestId: req.requestId },
        });
        return;
      }

      const event = await SecurityEventModel.findOne({ eventId: req.params.eventId });
      if (!event) {
        res.status(404).json({
          error: { code: "NOT_FOUND", message: "Event not found.", requestId: req.requestId },
        });
        return;
      }

      const objectKey = kind === "snapshot" ? event.evidence?.snapshotObjectKey : event.evidence?.clipObjectKey;
      if (!objectKey) {
        res.status(404).json({
          error: { code: "NOT_FOUND", message: "No evidence file recorded for this event.", requestId: req.requestId },
        });
        return;
      }

      const filePath = safeResolve(objectKey);
      if (!filePath || !fs.existsSync(filePath)) {
        res.status(404).json({
          error: { code: "NOT_FOUND", message: "Evidence file is not available.", requestId: req.requestId },
        });
        return;
      }

      res.sendFile(filePath);
    } catch (err) {
      next(err);
    }
  }
);
