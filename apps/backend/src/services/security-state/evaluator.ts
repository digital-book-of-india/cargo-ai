import { Types } from "mongoose";
import { MonitoringState, SecurityState } from "@dbi/api-types";
import { ShopModel, ScheduleModel, CameraModel, SecurityStateModel } from "../../models";
import { evaluateSchedule } from "../schedule/calculator";
import { getAiWorkerHealth } from "../ai/health";

export async function evaluateShopSecurityState(shopId: string | Types.ObjectId): Promise<SecurityState> {
  const shop = await ShopModel.findById(shopId);
  if (!shop) {
    throw new Error(`Shop with id ${shopId} not found`);
  }

  const [schedule, cameras, aiHealth, existingState] = await Promise.all([
    ScheduleModel.findOne({ shopId: shop._id }),
    CameraModel.find({ shopId: shop._id }),
    getAiWorkerHealth(),
    SecurityStateModel.findOne({ shopId: shop._id }),
  ]);

  const now = new Date();

  // If no schedule or no camera, state is SETUP_REQUIRED
  if (!schedule || cameras.length === 0) {
    const defaultState: SecurityState = {
      shopId: shop._id.toString(),
      desiredState: "DISARMED",
      actualMonitoringState: "SETUP_REQUIRED",
      cameraState: cameras.length === 0 ? "NO_CAMERA" : "OFFLINE",
      aiWorkerState: aiHealth.status,
      reason: !schedule ? "SCHEDULE_MISSING" : "NO_CAMERA_CONFIGURED",
      evaluatedAt: now.toISOString(),
    };

    await SecurityStateModel.findOneAndUpdate(
      { shopId: shop._id },
      {
        shopId: shop._id,
        desiredState: defaultState.desiredState,
        actualMonitoringState: defaultState.actualMonitoringState,
        cameraState: defaultState.cameraState,
        aiWorkerState: defaultState.aiWorkerState,
        reason: defaultState.reason,
        overrideUntil: null,
        evaluatedAt: now,
      },
      { upsert: true }
    );

    return defaultState;
  }

  // Calculate desired state from schedule or active manual override
  const scheduleEval = evaluateSchedule(schedule.toObject() as any, shop.timezone, now);
  const isOverrideActive = Boolean(
    existingState?.overrideUntil && new Date(existingState.overrideUntil) > now
  );

  const desiredState = isOverrideActive && existingState
    ? existingState.desiredState
    : scheduleEval.desiredState;

  const reason = isOverrideActive && existingState
    ? existingState.reason
    : scheduleEval.reason;

  // Check camera stream health
  const onlineCameras = cameras.filter((cam) => cam.status === "ONLINE");
  const cameraHealthy = onlineCameras.length > 0;
  const cameraState = cameraHealthy ? "ONLINE" : cameras[0]?.status ?? "OFFLINE";

  // Check AI worker health
  const aiHealthy = aiHealth.status === "ONLINE";

  let actualMonitoringState: MonitoringState = "DISARMED";

  if (desiredState === "ARMED") {
    if (cameraHealthy && aiHealthy) {
      actualMonitoringState = "MONITORING";
    } else if (!cameraHealthy && !aiHealthy) {
      actualMonitoringState = "OFFLINE";
    } else if (!cameraHealthy) {
      actualMonitoringState = "OFFLINE";
    } else {
      actualMonitoringState = "DEGRADED";
    }
  } else {
    actualMonitoringState = "DISARMED";
  }

  const securityState: SecurityState = {
    shopId: shop._id.toString(),
    desiredState,
    actualMonitoringState,
    cameraState,
    aiWorkerState: aiHealth.status,
    reason,
    scheduleVersion: schedule.version,
    evaluatedAt: now.toISOString(),
  };

  await SecurityStateModel.findOneAndUpdate(
    { shopId: shop._id },
    {
      shopId: shop._id,
      desiredState: securityState.desiredState,
      actualMonitoringState: securityState.actualMonitoringState,
      cameraState: securityState.cameraState,
      aiWorkerState: securityState.aiWorkerState,
      reason: securityState.reason,
      scheduleVersion: schedule.version,
      overrideUntil: isOverrideActive ? existingState!.overrideUntil : null,
      evaluatedAt: now,
      changedAt: now,
    },
    { upsert: true }
  );

  return securityState;
}
