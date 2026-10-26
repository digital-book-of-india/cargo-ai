import { Router, Request, Response } from "express";
import net from "net";
import { Types } from "mongoose";
import { assignCameraSiteSchema, cameraRegisterSchema, cameraUpdateSchema, zoneSchema } from "@dbi/validation";
import { CameraModel, SiteModel, ZoneModel } from "../../../models";
import { asyncHandler, guard, requireCameraAccess, requireSiteAccess } from "../../../middleware/auth";
import { AppError } from "../../../middleware/errorHandler";
import { cameraControlRateLimiter } from "../../../middleware/rateLimiter";
import { auditFromRequest } from "../../../services/audit/logger";
import { canAccessSite, hasAllSiteAccess } from "../../../services/authz/permissions";
import { encryptSecret, decryptSecret, sanitizeCamera, buildRtspUrl } from "../../../services/secrets/manager";

// Mounted at /api/v1/sites -> /:siteId/cameras
export const siteCamerasRouter = Router();
// Mounted at /api/v1/cameras
export const cameraRouter = Router();

function formatZone(zone: any) {
  return {
    id: zone._id.toString(),
    cameraId: zone.cameraId.toString(),
    companyId: zone.companyId.toString(),
    siteId: zone.siteId.toString(),
    zoneType: zone.zoneType,
    polygon: zone.polygon,
    sensitivity: zone.sensitivity,
    enabled: zone.enabled,
  };
}

// POST /api/v1/sites/:siteId/cameras
siteCamerasRouter.post(
  "/:siteId/cameras",
  ...requireSiteAccess("cameras:write"),
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = cameraRegisterSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, "VALIDATION_ERROR", parsed.error.errors[0]?.message ?? "Invalid camera registration");
    }
    const site = req.site!;
    if (site.status !== "ACTIVE") {
      throw new AppError(422, "BUSINESS_RULE_FAILED", "Cameras can only be added to an active site.");
    }

    const { name, protocol, host, port, username, password, path } = parsed.data;
    const streamUrl = buildRtspUrl({ protocol, host, port, username, password, path });

    const camera = await CameraModel.create({
      companyId: site.companyId,
      siteId: site._id,
      name,
      protocol,
      secretRef: encryptSecret(streamUrl),
      status: "PENDING_TEST",
      lastFrameAt: null,
    });

    // Never put the address or credentials in audit metadata.
    await auditFromRequest(req, "CAMERA_REGISTERED", "Camera", camera._id.toString(), {
      metadata: { siteId: site._id.toString(), name, protocol },
    });
    res.status(201).json({ data: { camera: sanitizeCamera(camera) } });
  })
);

// GET /api/v1/sites/:siteId/cameras
siteCamerasRouter.get(
  "/:siteId/cameras",
  ...requireSiteAccess("cameras:read"),
  asyncHandler(async (req: Request, res: Response) => {
    const cameras = await CameraModel.find({
      companyId: req.tenant!.companyId,
      siteId: req.site!._id,
    }).sort({ createdAt: -1 });
    res.json({ data: { items: cameras.map(sanitizeCamera) } });
  })
);

// GET /api/v1/cameras - cameras of the sites this member may access (?siteId= narrows)
cameraRouter.get(
  "/",
  ...guard("cameras:read"),
  asyncHandler(async (req: Request, res: Response) => {
    const filter: Record<string, unknown> = { companyId: req.tenant!.companyId };
    const siteIdParam = typeof req.query.siteId === "string" ? req.query.siteId : undefined;

    if (siteIdParam) {
      if (!Types.ObjectId.isValid(siteIdParam) || !canAccessSite(req.tenant!.role, req.tenant!.siteIds, siteIdParam)) {
        throw new AppError(404, "NOT_FOUND", "Site not found.");
      }
      filter.siteId = siteIdParam;
    } else if (!hasAllSiteAccess(req.tenant!.role)) {
      filter.siteId = { $in: req.tenant!.siteIds };
    }

    const cameras = await CameraModel.find(filter).sort({ createdAt: -1 }).limit(500);
    res.json({ data: { items: cameras.map(sanitizeCamera) } });
  })
);

// Attempts a real TCP connection to the camera's RTSP host:port.
// Does not pull video frames (needs the Python/OpenCV worker for that) but proves the
// stream endpoint is reachable instead of always claiming ONLINE.
async function probeStreamReachability(streamUrl: string): Promise<{ reachable: boolean; errorCode?: string }> {
  let host: string;
  let port: number;
  try {
    const parsed = new URL(streamUrl);
    host = parsed.hostname;
    port = Number(parsed.port) || (parsed.protocol === "rtsp:" ? 554 : 80);
  } catch {
    return { reachable: false, errorCode: "INVALID_STREAM_URL" };
  }

  if (!host) return { reachable: false, errorCode: "INVALID_STREAM_URL" };

  return new Promise((resolve) => {
    const socket = new net.Socket();
    const timeoutMs = 4000;
    let settled = false;

    const finish = (result: { reachable: boolean; errorCode?: string }) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish({ reachable: true }));
    socket.once("timeout", () => finish({ reachable: false, errorCode: "CONNECTION_TIMEOUT" }));
    socket.once("error", () => finish({ reachable: false, errorCode: "CONNECTION_REFUSED" }));

    socket.connect(port, host);
  });
}

// POST /api/v1/cameras/:cameraId/test
cameraRouter.post(
  "/:cameraId/test",
  ...requireCameraAccess("cameras:write"),
  cameraControlRateLimiter,
  asyncHandler(async (req: Request, res: Response) => {
    const camera = req.camera!;
    const streamUrl = decryptSecret(camera.secretRef);
    const { reachable, errorCode } = streamUrl
      ? await probeStreamReachability(streamUrl)
      : { reachable: false, errorCode: "NO_STREAM_URL" };

    const now = new Date();
    camera.status = reachable ? "ONLINE" : "ERROR";
    camera.lastHealthAt = now;
    camera.lastErrorCode = reachable ? null : errorCode ?? "UNREACHABLE";
    if (reachable) camera.lastFrameAt = now;
    await camera.save();

    res.json({
      data: {
        camera: sanitizeCamera(camera),
        message: reachable
          ? "Stream endpoint reachable. Feed marked online."
          : `Could not reach the camera stream (${camera.lastErrorCode}).`,
      },
    });
  })
);

// PATCH /api/v1/cameras/:cameraId
cameraRouter.patch(
  "/:cameraId",
  ...requireCameraAccess("cameras:write"),
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = cameraUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, "VALIDATION_ERROR", parsed.error.errors[0]?.message ?? "Invalid update payload");
    }
    const camera = req.camera!;

    const { name, protocol, host, port, username, password, path } = parsed.data;
    if (name) camera.name = name;
    if (protocol) camera.protocol = protocol;
    if (host) {
      const streamUrl = buildRtspUrl({
        protocol: protocol ?? camera.protocol,
        host,
        port,
        username,
        password,
        path,
      });
      camera.secretRef = encryptSecret(streamUrl);
      camera.status = "PENDING_TEST";
    }
    await camera.save();

    await auditFromRequest(req, "CAMERA_UPDATED", "Camera", camera._id.toString(), {
      metadata: { renamed: Boolean(name), connectionChanged: Boolean(host) },
    });
    res.json({ data: { camera: sanitizeCamera(camera) } });
  })
);

// POST /api/v1/cameras/:cameraId/assign-site - move a camera to another site of the same company
cameraRouter.post(
  "/:cameraId/assign-site",
  ...requireCameraAccess("cameras:write"),
  cameraControlRateLimiter,
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = assignCameraSiteSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, "VALIDATION_ERROR", parsed.error.errors[0]?.message ?? "Invalid site");
    }
    const camera = req.camera!;
    const targetId = parsed.data.siteId;

    // The target must be a site of the caller's own company that the caller may use.
    const target = Types.ObjectId.isValid(targetId)
      ? await SiteModel.findOne({ _id: targetId, companyId: req.tenant!.companyId })
      : null;
    if (!target || !canAccessSite(req.tenant!.role, req.tenant!.siteIds, target._id.toString())) {
      throw new AppError(404, "NOT_FOUND", "Site not found.");
    }
    if (target.status !== "ACTIVE") {
      throw new AppError(422, "BUSINESS_RULE_FAILED", "Cameras can only be assigned to an active site.");
    }

    const fromSiteId = camera.siteId.toString();
    if (fromSiteId !== target._id.toString()) {
      camera.siteId = target._id;
      await camera.save();
      await ZoneModel.updateMany({ cameraId: camera._id, companyId: camera.companyId }, { siteId: target._id });
      await auditFromRequest(req, "CAMERA_SITE_ASSIGNED", "Camera", camera._id.toString(), {
        metadata: { fromSiteId, toSiteId: target._id.toString() },
      });
    }

    res.json({ data: { camera: sanitizeCamera(camera) } });
  })
);

// PUT /api/v1/cameras/:cameraId/zones  (single shutter-style zone; replaced by /zones in Dev 2's work)
cameraRouter.put(
  "/:cameraId/zones",
  ...requireCameraAccess("zones:write"),
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = zoneSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, "VALIDATION_ERROR", parsed.error.errors[0]?.message ?? "Invalid zone definition");
    }
    const camera = req.camera!;
    const { zoneType, polygon, sensitivity, enabled } = parsed.data;

    const zone = await ZoneModel.findOneAndUpdate(
      { cameraId: camera._id, companyId: camera.companyId },
      {
        cameraId: camera._id,
        companyId: camera.companyId,
        siteId: camera.siteId,
        zoneType,
        polygon,
        sensitivity,
        enabled,
      },
      { upsert: true, new: true }
    );

    await auditFromRequest(req, "ZONE_SAVED", "Zone", zone._id.toString(), {
      metadata: { cameraId: camera._id.toString(), enabled },
    });
    res.json({ data: { zone: formatZone(zone) } });
  })
);

// GET /api/v1/cameras/:cameraId/zones
cameraRouter.get(
  "/:cameraId/zones",
  ...requireCameraAccess("zones:read"),
  asyncHandler(async (req: Request, res: Response) => {
    const zone = await ZoneModel.findOne({ cameraId: req.camera!._id, companyId: req.camera!.companyId });
    if (!zone) throw new AppError(404, "NOT_FOUND", "No zone defined for this camera.");
    res.json({ data: { zone: formatZone(zone) } });
  })
);

// DELETE /api/v1/cameras/:cameraId
cameraRouter.delete(
  "/:cameraId",
  ...requireCameraAccess("cameras:write"),
  asyncHandler(async (req: Request, res: Response) => {
    const camera = req.camera!;
    await CameraModel.deleteOne({ _id: camera._id, companyId: camera.companyId });
    await ZoneModel.deleteMany({ cameraId: camera._id, companyId: camera.companyId });
    await auditFromRequest(req, "CAMERA_DELETED", "Camera", camera._id.toString(), {
      metadata: { siteId: camera.siteId.toString(), name: camera.name },
    });
    res.json({ data: { id: camera._id.toString(), message: "Camera deleted successfully." } });
  })
);

// GET /api/v1/cameras/:cameraId/preview
// Returns an SVG test card used as the backdrop of the zone editor. It is a PLACEHOLDER, not a real frame:
// it must never be presented as live video (see CONTEXT_DEV1.md, open items).
cameraRouter.get(
  "/:cameraId/preview",
  ...requireCameraAccess("cameras:read"),
  async (req: Request, res: Response) => {
    // Generate clean 16:9 SVG test card frame with timestamp & camera ID
    const timeStr = new Date().toISOString();
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
        <rect width="1280" height="720" fill="#0f172a"/>
        <line x1="0" y1="360" x2="1280" y2="360" stroke="#334155" stroke-width="2" stroke-dasharray="8 8"/>
        <line x1="640" y1="0" x2="640" y2="720" stroke="#334155" stroke-width="2" stroke-dasharray="8 8"/>
        <circle cx="640" cy="360" r="100" fill="none" stroke="#38bdf8" stroke-width="2"/>
        <text x="640" y="340" fill="#f8fafc" font-size="28" font-family="sans-serif" font-weight="600" text-anchor="middle">CAMERA PREVIEW FEED</text>
        <text x="640" y="380" fill="#94a3b8" font-size="18" font-family="sans-serif" text-anchor="middle">ID: ${req.camera!._id.toString()}</text>
        <text x="640" y="680" fill="#64748b" font-size="16" font-family="monospace" text-anchor="middle">${timeStr}</text>
      </svg>
    `.trim();
    res.setHeader("Content-Type", "image/svg+xml");
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.send(svg);
  }
);
