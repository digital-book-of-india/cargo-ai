import crypto from "crypto";
import type { Request } from "express";
import { Types } from "mongoose";
import type { VisionGeometry, VisionZone, VisionZoneRules, VisionZoneType } from "@dbi/api-types";
import {
  checkVisionZoneConfig,
  type SaveVisionZoneInput,
  type UpdateVisionZoneInput,
} from "@dbi/validation";
import { CameraModel, VisionZoneModel, type IVisionZoneDocument } from "../../../models";
import { AppError } from "../../../middleware/errorHandler";
import { assertShopAccess } from "../shared/access";
import { parseObjectId } from "../shared/http";

// Deterministic JSON (sorted keys) so the same config always gives the same hash.
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const parts = Object.keys(obj)
      .filter((k) => obj[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`);
    return `{${parts.join(",")}}`;
  }
  return JSON.stringify(value);
}

// Hash of everything that affects detection. Changing it means "validate again".
export function computeZoneHash(z: {
  cameraId: Types.ObjectId | string;
  zoneType: VisionZoneType;
  geometry: unknown;
  rules: unknown;
}): string {
  return crypto
    .createHash("sha256")
    .update(
      stableStringify({
        cameraId: String(z.cameraId),
        zoneType: z.zoneType,
        geometry: z.geometry,
        rules: z.rules,
      })
    )
    .digest("hex");
}

export function toVisionZoneDto(zone: IVisionZoneDocument): VisionZone {
  return {
    id: zone._id.toString(),
    siteId: zone.shopId.toString(),
    cameraId: zone.cameraId.toString(),
    name: zone.name,
    zoneType: zone.zoneType,
    geometry: zone.geometry,
    rules: zone.rules,
    status: zone.status,
    validationStatus: zone.validationStatus,
    validationIssues: zone.validationIssues ?? [],
    createdAt: zone.createdAt?.toISOString(),
    updatedAt: zone.updatedAt?.toISOString(),
  };
}

async function assertCameraInSite(cameraId: Types.ObjectId, shopId: Types.ObjectId): Promise<void> {
  const camera = await CameraModel.findById(cameraId).select("shopId").lean();
  // Same 404 for "missing" and "other site": no existence leak across tenants.
  if (!camera || String(camera.shopId) !== shopId.toString()) {
    throw new AppError(404, "NOT_FOUND", "Camera not found for this site.");
  }
}

// Loads a zone and checks the user's access to its site. Used by every /zones/:zoneId route.
export async function loadZoneForUser(req: Request, zoneIdParam: string): Promise<IVisionZoneDocument> {
  const zoneId = parseObjectId(zoneIdParam, "zoneId");
  const zone = await VisionZoneModel.findById(zoneId);
  if (!zone) throw new AppError(404, "NOT_FOUND", "Zone not found.");
  await assertShopAccess(req, zone.shopId.toString());
  return zone;
}

export async function listZones(
  req: Request,
  input: { siteId: string; cameraId?: string; cursor?: string; limit: number }
): Promise<{ items: VisionZone[]; nextCursor: string | null }> {
  const shopId = parseObjectId(input.siteId, "siteId");
  await assertShopAccess(req, shopId.toString());

  const filter: Record<string, any> = { shopId };
  if (input.cameraId) filter.cameraId = parseObjectId(input.cameraId, "cameraId");
  if (input.cursor) filter._id = { $gt: parseObjectId(input.cursor, "cursor") };

  const docs = await VisionZoneModel.find(filter).sort({ _id: 1 }).limit(input.limit + 1);
  const hasMore = docs.length > input.limit;
  const items = docs.slice(0, input.limit);
  return {
    items: items.map(toVisionZoneDto),
    nextCursor: hasMore ? items[items.length - 1]._id.toString() : null,
  };
}

export async function createZone(req: Request, input: SaveVisionZoneInput): Promise<VisionZone> {
  const shopId = parseObjectId(input.siteId, "siteId");
  await assertShopAccess(req, shopId.toString());
  const cameraId = parseObjectId(input.cameraId, "cameraId");
  await assertCameraInSite(cameraId, shopId);

  const zone = await VisionZoneModel.create({
    shopId,
    cameraId,
    name: input.name,
    zoneType: input.zoneType,
    geometry: input.geometry,
    rules: input.rules,
    status: "draft",
    validationStatus: "pending",
    validationIssues: [],
    validatedHash: null,
    createdBy: req.user && Types.ObjectId.isValid(req.user.id) ? new Types.ObjectId(req.user.id) : null,
  });
  return toVisionZoneDto(zone);
}

export async function updateZone(zone: IVisionZoneDocument, patch: UpdateVisionZoneInput): Promise<VisionZone> {
  const hashBefore = computeZoneHash(zone);

  const next = {
    zoneType: (patch.zoneType ?? zone.zoneType) as VisionZoneType,
    geometry: patch.geometry ?? zone.geometry,
    rules: (patch.rules ?? zone.rules) as VisionZoneRules,
  };
  const issues = checkVisionZoneConfig(next);
  if (issues.length > 0) throw new AppError(400, "VALIDATION_ERROR", issues[0]);

  if (patch.name !== undefined) zone.name = patch.name;
  zone.zoneType = next.zoneType;
  zone.geometry = next.geometry as VisionGeometry;
  zone.rules = next.rules;

  const hashAfter = computeZoneHash(zone);
  if (hashAfter !== hashBefore) {
    // Detection-relevant change: monitoring must stop until the zone is validated again.
    zone.status = "draft";
    zone.validationStatus = "pending";
    zone.validationIssues = [];
    zone.validatedHash = null;
  }

  await zone.save();
  return toVisionZoneDto(zone);
}

export async function validateZone(
  zone: IVisionZoneDocument
): Promise<{ passed: boolean; issues: string[] }> {
  const issues: string[] = [];

  const camera = await CameraModel.findById(zone.cameraId).select("shopId secretRef").lean();
  if (!camera || String(camera.shopId) !== zone.shopId.toString()) {
    issues.push("Camera does not belong to this site.");
  } else if (!camera.secretRef) {
    issues.push("Camera has no stream configured yet.");
  }

  issues.push(...checkVisionZoneConfig({ zoneType: zone.zoneType, geometry: zone.geometry, rules: zone.rules }));

  const passed = issues.length === 0;
  zone.validationStatus = passed ? "valid" : "invalid";
  zone.validationIssues = issues;
  zone.validatedHash = passed ? computeZoneHash(zone) : null;
  await zone.save();

  return { passed, issues };
}

export async function enableZone(zone: IVisionZoneDocument): Promise<VisionZone> {
  if (zone.validationStatus !== "valid") {
    throw new AppError(422, "BUSINESS_RULE_FAILED", "Validate the zone before enabling monitoring.");
  }
  if (zone.validatedHash !== computeZoneHash(zone)) {
    zone.validationStatus = "pending";
    zone.validatedHash = null;
    zone.validationIssues = [];
    zone.status = "draft";
    await zone.save();
    throw new AppError(422, "BUSINESS_RULE_FAILED", "The zone changed after validation. Validate it again.");
  }

  zone.status = "active";
  await zone.save();
  return toVisionZoneDto(zone);
}