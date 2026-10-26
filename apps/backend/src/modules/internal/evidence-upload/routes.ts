import { Router, Request, Response } from "express";
import { Types } from "mongoose";
import multer from "multer";
import { env } from "../../../config/env";
import { CameraModel, SiteModel } from "../../../models";
import { asyncHandler } from "../../../middleware/auth";
import { AppError } from "../../../middleware/errorHandler";
import { saveEvidence } from "../../../services/evidence/service";

export const evidenceUploadRouter = Router();

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: env.evidenceMaxUploadBytes, files: 1 } });

// POST /internal/v1/evidence/upload (service token; multipart: file, siteId, cameraId)
// The server generates the storage key and returns it. A worker cannot choose where a file is
// stored, and an event may only reference a key that came back from this endpoint.
evidenceUploadRouter.post(
  "/upload",
  (req: Request, res: Response, next) => {
    upload.single("file")(req, res, (err: unknown) => {
      if ((err as { code?: string } | null)?.code === "LIMIT_FILE_SIZE") {
        return next(new AppError(413, "PAYLOAD_TOO_LARGE", "The evidence file is too large."));
      }
      next(err);
    });
  },
  asyncHandler(async (req: Request, res: Response) => {
    const siteId = String(req.body?.siteId ?? "");
    const cameraId = String(req.body?.cameraId ?? "");
    if (!req.file) throw new AppError(400, "VALIDATION_ERROR", "A file is required.");

    const site = Types.ObjectId.isValid(siteId) ? await SiteModel.findById(siteId).select("companyId status") : null;
    if (!site) throw new AppError(404, "NOT_FOUND", "Site not found.");
    if (site.status === "ARCHIVED") throw new AppError(422, "BUSINESS_RULE_FAILED", "The site is archived.");
    const camera = Types.ObjectId.isValid(cameraId)
      ? await CameraModel.exists({ _id: cameraId, siteId: site._id, companyId: site.companyId })
      : null;
    if (!camera) throw new AppError(400, "VALIDATION_ERROR", "cameraId does not belong to the site.");

    const saved = await saveEvidence({
      companyId: site.companyId,
      siteId: site._id,
      contentType: req.file.mimetype,
      data: req.file.buffer,
    });
    res.status(201).json({
      data: { objectKey: saved.objectKey, kind: saved.kind, checksum: saved.checksum, sizeBytes: saved.sizeBytes },
    });
  })
);
