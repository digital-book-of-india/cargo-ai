import { connectDatabase, disconnectDatabase } from "../config/db";
import {
  CameraModel,
  CompanyMemberModel,
  CompanyModel,
  InvitationModel,
  CargoEventModel,
  EventHistoryModel,
  EventNoteModel,
  NotificationModel,
  SiteModel,
  UserModel,
  ZoneModel,
} from "../models";
import { hashPassword } from "../utils/auth";
import { createCargoEvent } from "../services/events/createEvent";
import { encryptSecret, buildRtspUrl } from "../services/secrets/manager";
import type { CompanyRole } from "@dbi/api-types";

// All seeded data is DEMO data. Never run this against a production database: it deletes and
// recreates the demo accounts below on every run.
const DEMO_USERS = {
  platformAdmin: { name: "DEMO Platform Admin", email: "admin@dbi.com", password: "Admin@123456" },
  owner: { name: "DEMO Company Owner", email: "owner@dbi.com", password: "Owner@123456" },
  admin: { name: "DEMO Company Admin", email: "companyadmin@dbi.com", password: "Admin@123456" },
  manager: { name: "DEMO Warehouse Manager", email: "manager@dbi.com", password: "Manager@123456" },
  operator: { name: "DEMO Security Operator", email: "operator@dbi.com", password: "Operator@123456" },
  auditor: { name: "DEMO Auditor", email: "auditor@dbi.com", password: "Auditor@123456" },
  otherOwner: { name: "DEMO Other Company Owner", email: "other-owner@dbi.com", password: "Owner@123456" },
};

async function seed() {
  console.log("Starting CargoSense AI database seed...");
  await connectDatabase();

  // 1. Clear previous DEMO data, including everything that belongs to a demo company.
  console.log("Clearing existing demo data...");
  const demoCompanies = await CompanyModel.find({ demo: true }).select("_id");
  const demoCompanyIds = demoCompanies.map((c) => c._id);
  const demoEmails = Object.values(DEMO_USERS).map((u) => u.email);
  const demoUsers = await UserModel.find({ email: { $in: demoEmails } }).select("_id");
  const demoUserIds = demoUsers.map((u) => u._id);

  if (demoCompanyIds.length > 0) {
    await Promise.all([
      ZoneModel.deleteMany({ companyId: { $in: demoCompanyIds } }),
      CameraModel.deleteMany({ companyId: { $in: demoCompanyIds } }),
      SiteModel.deleteMany({ companyId: { $in: demoCompanyIds } }),
      CargoEventModel.deleteMany({ companyId: { $in: demoCompanyIds } }),
      EventHistoryModel.deleteMany({ companyId: { $in: demoCompanyIds } }),
      EventNoteModel.deleteMany({ companyId: { $in: demoCompanyIds } }),
      NotificationModel.deleteMany({ companyId: { $in: demoCompanyIds } }),
      InvitationModel.deleteMany({ companyId: { $in: demoCompanyIds } }),
      CompanyMemberModel.deleteMany({ companyId: { $in: demoCompanyIds } }),
    ]);
    await CompanyModel.deleteMany({ _id: { $in: demoCompanyIds } });
  }
  await CompanyMemberModel.deleteMany({ userId: { $in: demoUserIds } });
  await UserModel.deleteMany({ _id: { $in: demoUserIds } });

  // 2. Users
  console.log("Creating demo users...");
  const create = async (u: { name: string; email: string; password: string }, role: "PLATFORM_ADMIN" | "USER") =>
    UserModel.create({
      name: u.name,
      email: u.email,
      passwordHash: await hashPassword(u.password),
      role,
      status: "ACTIVE",
    });
  const platformAdmin = await create(DEMO_USERS.platformAdmin, "PLATFORM_ADMIN");
  const owner = await create(DEMO_USERS.owner, "USER");
  const admin = await create(DEMO_USERS.admin, "USER");
  const manager = await create(DEMO_USERS.manager, "USER");
  const operator = await create(DEMO_USERS.operator, "USER");
  const auditor = await create(DEMO_USERS.auditor, "USER");
  const otherOwner = await create(DEMO_USERS.otherOwner, "USER");

  // 3. Company and sites
  const company = await CompanyModel.create({
    name: "DEMO Cargo Logistics",
    timezone: "Asia/Kolkata",
    demo: true,
    createdBy: owner._id,
  });
  const north = await SiteModel.create({
    companyId: company._id,
    name: "DEMO North Warehouse",
    code: "WH-NORTH",
    timezone: "Asia/Kolkata",
    address: { city: "Delhi", state: "Delhi", postalCode: "110001" },
    status: "ACTIVE",
    demo: true,
    createdBy: owner._id,
  });
  const south = await SiteModel.create({
    companyId: company._id,
    name: "DEMO South Hub",
    code: "WH-SOUTH",
    timezone: "Asia/Kolkata",
    address: { city: "Chennai", state: "Tamil Nadu", postalCode: "600001" },
    status: "ACTIVE",
    demo: true,
    createdBy: owner._id,
  });
  console.log(`Created company ${company.name} with sites ${north.code}, ${south.code}`);

  const member = (userId: any, role: CompanyRole, siteIds: any[] = []) =>
    CompanyMemberModel.create({ companyId: company._id, userId, role, status: "ACTIVE", siteIds });
  await member(owner._id, "COMPANY_OWNER");
  await member(admin._id, "COMPANY_ADMIN");
  await member(manager._id, "WAREHOUSE_MANAGER", [north._id]);
  await member(operator._id, "SECURITY_OPERATOR", [north._id]);
  await member(auditor._id, "AUDITOR", [north._id, south._id]);

  // A second company, so tenant isolation can be tried by hand.
  const otherCompany = await CompanyModel.create({
    name: "DEMO Other Company",
    timezone: "Asia/Kolkata",
    demo: true,
    createdBy: otherOwner._id,
  });
  await SiteModel.create({
    companyId: otherCompany._id,
    name: "DEMO Other Warehouse",
    code: "WH-OTHER",
    timezone: "Asia/Kolkata",
    status: "ACTIVE",
    demo: true,
    createdBy: otherOwner._id,
  });
  await CompanyMemberModel.create({
    companyId: otherCompany._id,
    userId: otherOwner._id,
    role: "COMPANY_OWNER",
    status: "ACTIVE",
    siteIds: [],
  });

  // 4. Camera. Uses a real camera when CAMERA_RTSP_HOST is set; the owner-facing form never reads these.
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
    companyId: company._id,
    siteId: north._id,
    name: hasRealCamera ? "Loading Bay Camera" : "DEMO Loading Bay Camera",
    protocol: "RTSP",
    secretRef: encryptSecret(streamUrl),
    // Never claim a demo camera is online: it has not been tested, so it stays PENDING_TEST.
    status: "PENDING_TEST",
    lastFrameAt: null,
    lastHealthAt: null,
  });
  console.log(
    hasRealCamera
      ? `Using your real camera from .env (${host}); test it from the owner panel.`
      : "No CAMERA_RTSP_HOST set: seeded a fake DEMO stream instead."
  );

  // 5. Zone (shutter-style polygon until the cargo zone model replaces it)
  await ZoneModel.create({
    cameraId: camera._id,
    companyId: company._id,
    siteId: north._id,
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

  // 6. Demo events. They go through createCargoEvent(), the same path the AI pipeline uses, so
  // they get history and notifications. No evidence files are faked: these events have none.
  const first = await createCargoEvent({
    eventKey: "demo-restricted-zone-01",
    siteId: north._id.toString(),
    cameraId: camera._id.toString(),
    eventType: "restricted_zone_movement",
    occurredAt: new Date(Date.now() - 45 * 60 * 1000),
    payload: { note: "DEMO event" },
    demo: true,
  });
  const second = await createCargoEvent({
    eventKey: "demo-line-crossing-02",
    siteId: north._id.toString(),
    cameraId: camera._id.toString(),
    eventType: "package_line_crossing",
    occurredAt: new Date(Date.now() - 150 * 60 * 1000),
    payload: { movement: { direction: "OUT", countDelta: 1 }, note: "DEMO event" },
    demo: true,
  });
  // one event already acknowledged by the demo operator, with history
  await CargoEventModel.updateOne({ _id: second.event._id }, { $set: { status: "acknowledged" } });
  await EventHistoryModel.create({
    companyId: company._id,
    eventId: second.event._id,
    actorUserId: operator._id,
    action: "ACKNOWLEDGED",
    fromStatus: "open",
    toStatus: "acknowledged",
    note: "DEMO review",
  });
  void first;

  console.log("\n==========================================");
  console.log("Seed completed successfully (all DEMO data).");
  console.log(`  Platform admin : ${DEMO_USERS.platformAdmin.email} / ${DEMO_USERS.platformAdmin.password}`);
  console.log(`  Company owner  : ${DEMO_USERS.owner.email} / ${DEMO_USERS.owner.password}`);
  console.log(`  Company admin  : ${DEMO_USERS.admin.email} / ${DEMO_USERS.admin.password}`);
  console.log(`  Manager (north): ${DEMO_USERS.manager.email} / ${DEMO_USERS.manager.password}`);
  console.log(`  Operator(north): ${DEMO_USERS.operator.email} / ${DEMO_USERS.operator.password}`);
  console.log(`  Auditor        : ${DEMO_USERS.auditor.email} / ${DEMO_USERS.auditor.password}`);
  console.log(`  Other company  : ${DEMO_USERS.otherOwner.email} / ${DEMO_USERS.otherOwner.password}`);
  console.log("==========================================\n");
  void platformAdmin;
  void south;

  await disconnectDatabase();
}

seed().catch((err) => {
  console.error("Seed error:", err);
  process.exit(1);
});
