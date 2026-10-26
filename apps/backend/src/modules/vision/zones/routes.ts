import { Router } from "express";
import { saveVisionZoneSchema, updateVisionZoneSchema } from "@dbi/validation";
import { authenticate } from "../../../middleware/auth";
import { AppError } from "../../../middleware/errorHandler";
import { asyncHandler, parseLimit, parseOrThrow } from "../shared/http";
import {
  createZone,
  enableZone,
  listZones,
  loadZoneForUser,
  toVisionZoneDto,
  updateZone,
  validateZone,
} from "./service";

// Mounted at /api/v1/zones (spec section 7)
export const visionZonesRouter = Router();

visionZonesRouter.use(authenticate);

// GET /api/v1/zones?siteId=...&cameraId=...&cursor=...&limit=...
visionZonesRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const siteId = typeof req.query.siteId === "string" ? req.query.siteId : "";
    if (!siteId) throw new AppError(400, "VALIDATION_ERROR", "siteId is required.");

    const data = await listZones(req, {
      siteId,
      cameraId: typeof req.query.cameraId === "string" ? req.query.cameraId : undefined,
      cursor: typeof req.query.cursor === "string" ? req.query.cursor : undefined,
      limit: parseLimit(req.query.limit),
    });
    res.json({ data });
  })
);

// POST /api/v1/zones
visionZonesRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const input = parseOrThrow(saveVisionZoneSchema, req.body);
    const zone = await createZone(req, input);
    res.status(201).json({ data: { zone } });
  })
);

// GET /api/v1/zones/:zoneId
visionZonesRouter.get(
  "/:zoneId",
  asyncHandler(async (req, res) => {
    const zone = await loadZoneForUser(req, req.params.zoneId);
    res.json({ data: { zone: toVisionZoneDto(zone) } });
  })
);

// PATCH /api/v1/zones/:zoneId
visionZonesRouter.patch(
  "/:zoneId",
  asyncHandler(async (req, res) => {
    const patch = parseOrThrow(updateVisionZoneSchema, req.body);
    const zone = await loadZoneForUser(req, req.params.zoneId);
    const dto = await updateZone(zone, patch);
    res.json({ data: { zone: dto } });
  })
);

// POST /api/v1/zones/:zoneId/validate
// Returns 200 with passed=false when the zone is invalid (that is a result, not a server error).
visionZonesRouter.post(
  "/:zoneId/validate",
  asyncHandler(async (req, res) => {
    const zone = await loadZoneForUser(req, req.params.zoneId);
    const { passed } = await validateZone(zone);
    res.json({ data: { zone: toVisionZoneDto(zone), passed } });
  })
);

// POST /api/v1/zones/:zoneId/enable (monitoring only after validation, spec 5.1)
visionZonesRouter.post(
  "/:zoneId/enable",
  asyncHandler(async (req, res) => {
    const zone = await loadZoneForUser(req, req.params.zoneId);
    const dto = await enableZone(zone);
    res.json({ data: { zone: dto } });
  })
);