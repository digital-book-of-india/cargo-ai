import mongoose from "mongoose";
import { env } from "../config/env";
import { connectDatabase, disconnectDatabase } from "../config/db";
import {
  UserModel,
  ShopModel,
  ScheduleModel,
  CameraModel,
  ZoneModel,
  SecurityEventModel,
  NotificationModel,
} from "../models";
import { hashPassword } from "../utils/auth";
import { encryptSecret, buildRtspUrl } from "../services/secrets/manager";
import { evaluateShopSecurityState } from "../services/security-state/evaluator";

async function seed() {
  console.log("🌱 Starting DBI Intelligence database seed...");
  await connectDatabase();

  // 1. Clear previous DEMO data (cascade: a demo shop's cameras/schedules/zones/notifications
  // must go with it, otherwise re-running this script leaves orphaned records pointing at a
  // shopId that no longer exists — e.g. the superadmin Health page would list cameras for
  // shops that don't exist anymore.)
  console.log("Clearing existing demo data...");
  const oldDemoUsers = await UserModel.find({ email: { $in: ["admin@dbi.com", "owner@dbi.com"] } }).select("_id");
  const oldDemoUserIds = oldDemoUsers.map((u) => u._id);

  const oldDemoShops = await ShopModel.find({ demo: true }).select("_id");
  const oldDemoShopIds = oldDemoShops.map((s) => s._id);

  if (oldDemoShopIds.length > 0) {
    await Promise.all([
      ZoneModel.deleteMany({ shopId: { $in: oldDemoShopIds } }),
      ScheduleModel.deleteMany({ shopId: { $in: oldDemoShopIds } }),
      CameraModel.deleteMany({ shopId: { $in: oldDemoShopIds } }),
    ]);
  }
  if (oldDemoUserIds.length > 0) {
    await NotificationModel.deleteMany({ recipientUserId: { $in: oldDemoUserIds } });
  }

  await UserModel.deleteMany({ _id: { $in: oldDemoUserIds } });
  await ShopModel.deleteMany({ demo: true });
  await SecurityEventModel.deleteMany({ demoFlag: true });

  // 2. Create Users
  console.log("Creating default users...");
  const adminPasswordHash = await hashPassword("Admin@123456");
  const adminUser = await UserModel.create({
    name: "DEMO Super Admin",
    email: "admin@dbi.com",
    passwordHash: adminPasswordHash,
    role: "SUPER_ADMIN",
    status: "ACTIVE",
  });

  const ownerPasswordHash = await hashPassword("Owner@123456");
  const ownerUser = await UserModel.create({
    name: "DEMO Shop Owner",
    email: "owner@dbi.com",
    passwordHash: ownerPasswordHash,
    role: "SHOP_OWNER",
    status: "ACTIVE",
  });

  console.log(`✅ Created Super Admin: admin@dbi.com`);
  console.log(`✅ Created Shop Owner: owner@dbi.com`);

  // 3. Create Shop
  const shop = await ShopModel.create({
    ownerId: ownerUser._id,
    name: "DEMO Main Street Electronics",
    timezone: "Asia/Kolkata",
    address: {
      city: "Delhi",
      state: "Delhi",
      postalCode: "110001",
    },
    status: "ACTIVE",
    demo: true,
  });
  console.log(`✅ Created Shop: ${shop.name} (${shop._id})`);

  // 4. Create Schedule
  const weeklySchedule = [
    { day: "MON", openTime: "10:00", closeTime: "22:00", closed: false, closesNextDay: false },
    { day: "TUE", openTime: "10:00", closeTime: "22:00", closed: false, closesNextDay: false },
    { day: "WED", openTime: "10:00", closeTime: "22:00", closed: false, closesNextDay: false },
    { day: "THU", openTime: "10:00", closeTime: "22:00", closed: false, closesNextDay: false },
    { day: "FRI", openTime: "10:00", closeTime: "22:00", closed: false, closesNextDay: false },
    { day: "SAT", openTime: "10:00", closeTime: "22:00", closed: false, closesNextDay: false },
    { day: "SUN", openTime: "10:00", closeTime: "20:00", closed: true, closesNextDay: false },
  ];

  await ScheduleModel.create({
    shopId: shop._id,
    weeklySchedule,
    gracePeriodMinutes: 5,
    version: 1,
  });
  console.log("✅ Created 7-day schedule with 5min grace period");

  // 5. Create Camera
  // Uses your real camera if CAMERA_RTSP_HOST (etc.) is set in .env — these vars only feed the
  // seed script's demo shop, the real owner-facing "add camera" form never reads them.
  const now = new Date();
  const host = process.env.CAMERA_RTSP_HOST;
  const hasRealCamera = Boolean(host);
  const streamUrl = hasRealCamera
    ? buildRtspUrl({
        protocol: "RTSP",
        host: host!,
        port: Number(process.env.CAMERA_RTSP_PORT) || 554,
        username: process.env.CAMERA_RTSP_USERNAME,
        password: process.env.CAMERA_RTSP_PASSWORD,
        path: process.env.CAMERA_RTSP_PATH,
      })
    : "rtsp://demo-camera-stream:554/live/stream1";

  const camera = await CameraModel.create({
    shopId: shop._id,
    name: hasRealCamera ? "Front Shutter Camera" : "DEMO Front Shutter Camera",
    protocol: "RTSP",
    secretRef: encryptSecret(streamUrl),
    status: hasRealCamera ? "PENDING_TEST" : "ONLINE",
    lastFrameAt: hasRealCamera ? null : now,
    lastHealthAt: hasRealCamera ? null : now,
  });
  console.log(
    hasRealCamera
      ? `   Using your real camera from .env (${host}:${process.env.CAMERA_RTSP_PORT || 554}) — test it from the owner panel.`
      : "   No CAMERA_RTSP_HOST set in .env — seeded a fake DEMO stream instead."
  );
  console.log(`✅ Created Camera: ${camera.name} (${camera._id})`);

  // 6. Create Shutter Zone
  const zone = await ZoneModel.create({
    cameraId: camera._id,
    shopId: shop._id,
    zoneType: "SHUTTER",
    polygon: [
      { x: 0.12, y: 0.22 },
      { x: 0.88, y: 0.22 },
      { x: 0.91, y: 0.91 },
      { x: 0.1, y: 0.91 },
    ],
    sensitivity: "MEDIUM",
    enabled: true,
  });
  console.log("✅ Created Shutter polygon zone");

  // 7. Create Demo Events
  const event1 = await SecurityEventModel.create({
    eventId: "evt_demo_shutter_01",
    shopId: shop._id,
    cameraId: camera._id,
    eventType: "POSSIBLE_SHUTTER_INTERACTION",
    confidence: 0.89,
    startedAt: new Date(Date.now() - 45 * 60 * 1000), // 45 min ago
    evidence: {
      snapshotObjectKey: `private/shop_${shop._id}/events/demo_evt_01.jpg`,
    },
    reviewStatus: "NEW",
    demoFlag: true,
    modelVersion: "detector-v0.1",
  });

  const event2 = await SecurityEventModel.create({
    eventId: "evt_demo_zone_02",
    shopId: shop._id,
    cameraId: camera._id,
    eventType: "PERSON_IN_ZONE",
    confidence: 0.74,
    startedAt: new Date(Date.now() - 150 * 60 * 1000), // 2.5 hrs ago
    evidence: {
      snapshotObjectKey: `private/shop_${shop._id}/events/demo_evt_02.jpg`,
    },
    reviewStatus: "REVIEWED",
    demoFlag: true,
    modelVersion: "detector-v0.1",
  });

  await NotificationModel.create({
    eventId: event1.eventId,
    recipientUserId: ownerUser._id,
    channel: "IN_APP",
    status: "SENT",
    attempts: 1,
  });

  console.log("✅ Created 2 DEMO security events and notifications");

  // 8. Evaluate initial security state
  const state = await evaluateShopSecurityState(shop._id);
  console.log(`✅ Evaluated initial Security State: [Desired: ${state.desiredState}, Actual: ${state.actualMonitoringState}]`);

  console.log("\n==========================================");
  console.log("🎉 Seed completed successfully!");
  console.log("   Admin: admin@dbi.com / Admin@123456");
  console.log("   Owner: owner@dbi.com / Owner@123456");
  console.log("==========================================\n");

  await disconnectDatabase();
}

seed().catch((err) => {
  console.error("❌ Seed error:", err);
  process.exit(1);
});
