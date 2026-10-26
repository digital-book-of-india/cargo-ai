import { Router, Request, Response, NextFunction } from "express";
import path from "path";
import fs from "fs";
import multer from "multer";

export const evidenceUploadRouter = Router();

const STORAGE_ROOT = path.resolve(process.cwd(), process.env.EVIDENCE_STORAGE_DIR || "storage/evidence");
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

function safeResolve(objectKey: string): string | null {
  const resolved = path.resolve(STORAGE_ROOT, objectKey);
  if (resolved !== STORAGE_ROOT && !resolved.startsWith(STORAGE_ROOT + path.sep)) return null; // path traversal guard
  return resolved;
}

// POST /internal/v1/evidence/upload (multipart: file=<jpeg>, objectKey=<string>)
// The AI worker calls this right before submitting the matching security event, so the
// evidence.snapshotObjectKey it sends always resolves to a real file on disk.
evidenceUploadRouter.post(
  "/upload",
  upload.single("file"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const objectKey = String(req.body?.objectKey ?? "").trim();
      if (!objectKey || !req.file) {
        res.status(400).json({
          error: {
            code: "VALIDATION_ERROR",
            message: "objectKey and file are required.",
            requestId: req.requestId,
          },
        });
        return;
      }

      const filePath = safeResolve(objectKey);
      if (!filePath) {
        res.status(400).json({
          error: { code: "VALIDATION_ERROR", message: "Invalid objectKey.", requestId: req.requestId },
        });
        return;
      }

      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, req.file.buffer);

      res.status(201).json({ data: { objectKey, bytes: req.file.buffer.length } });
    } catch (err) {
      next(err);
    }
  }
);
