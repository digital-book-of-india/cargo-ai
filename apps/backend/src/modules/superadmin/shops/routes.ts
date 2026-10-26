import { Router, Request, Response } from "express";
import mongoose from "mongoose";
import {
  requireAdmin,
  adminRateLimiter,
  sendSuccess,
  sendError,
  AuthenticatedAdminRequest,
} from "../../../middleware/adminAuth";
import { ShopModel, CameraModel, AuditLogModel } from "../../../models";
import {
  parsePagination,
  escapeRegex,
  isValidObjectId,
  sanitizeString,
  supportsTransactions,
} from "../../../utils/adminHelpers";

export const adminShopsRouter = Router();

adminShopsRouter.use(adminRateLimiter);
adminShopsRouter.use(requireAdmin);

const VALID_STATUSES = ["ACTIVE", "PENDING_SETUP", "SUSPENDED"];

adminShopsRouter.get("/", async (req: Request, res: Response) => {
  const adminReq = req as AuthenticatedAdminRequest;
  const requestId = adminReq.requestId;
  try {
    const { page, limit, skip } = parsePagination(req.query);
    const search = sanitizeString(req.query.search);
    const status = sanitizeString(req.query.status);

    const filter: any = {};
    if (search) {
      const safeRegex = new RegExp(escapeRegex(search), "i");
      filter.$or = [{ name: safeRegex }, { "address.city": safeRegex }];
    }

    if (status && status !== "ALL") {
      if (!VALID_STATUSES.includes(status)) {
        return sendError(res, "INVALID_QUERY", "Invalid status query filter.", 400, requestId);
      }
      filter.status = status;
    }

    const [shopsRaw, total] = await Promise.all([
      ShopModel.find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip(skip)
        .limit(limit)
        .populate("ownerId", "name email")
        .lean(),
      ShopModel.countDocuments(filter),
    ]);

    const shops = shopsRaw.map((s: any) => ({
      _id: s._id,
      name: s.name,
      timezone: s.timezone,
      address: s.address,
      status: s.status,
      demoFlag: Boolean((s as any).demo ?? (s as any).demoFlag),
      owner: s.ownerId ? { id: s.ownerId._id, name: s.ownerId.name, email: s.ownerId.email } : null,
      createdAt: s.createdAt,
    }));

    return sendSuccess(
      res,
      { shops },
      { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
      requestId
    );
  } catch (error: any) {
    console.error(`[AdminShopsError] reqId: ${requestId}`, error);
    return sendError(res, "INTERNAL_ERROR", "Failed to retrieve registered shops.", 500, requestId);
  }
});

adminShopsRouter.patch("/:shopId/status", async (req: Request, res: Response) => {
  const adminReq = req as AuthenticatedAdminRequest;
  const requestId = adminReq.requestId;
  try {
    const { shopId } = req.params;

    let body = req.body;
    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch {
        body = {};
      }
    }
    body = body || {};

    const status = sanitizeString(body.status);
    const reason = sanitizeString(body.reason);

    // 1. Pre-DB Validation
    if (!isValidObjectId(shopId)) {
      return sendError(res, "INVALID_ID", "Invalid shop ID parameter.", 400, requestId);
    }

    if (!["ACTIVE", "SUSPENDED"].includes(status)) {
      return sendError(res, "INVALID_STATUS", "Status must be either ACTIVE or SUSPENDED.", 400, requestId);
    }

    if (!reason || reason.length < 5) {
      return sendError(res, "INVALID_REASON", "A mandatory reason (minimum 5 characters) is required.", 400, requestId);
    }

    // 2. Database Fetch
    const shop = await ShopModel.findById(shopId);
    if (!shop) {
      return sendError(res, "NOT_FOUND", "Shop not found.", 404, requestId);
    }

    if (shop.status === status) {
      return sendError(res, "CONFLICT", `Shop is already in the requested status: ${status}`, 409, requestId);
    }

    let appliedStatus = status;
    let note: string | undefined = undefined;

    if (status === "ACTIVE") {
      const cameraExists = await CameraModel.exists({ shopId });

      if (!cameraExists) {
        appliedStatus = "PENDING_SETUP";
        note = "Reactivated as PENDING_SETUP: no camera is configured.";
      }
    }

    if (appliedStatus === shop.status) {
      return sendError(
        res,
        "CONFLICT",
        `Shop setup is incomplete; remaining at ${shop.status}. No status change occurred.`,
        409,
        requestId
      );
    }

    const action = status === "SUSPENDED" ? "SHOP_SUSPENDED" : "SHOP_ACTIVATED";
    const auditReason = note ? `[${note}] Reason: ${reason}` : reason;

    // 3. Atomic Execution with Standalone Compensating Rollback
    const hasTx = await supportsTransactions();
    if (hasTx) {
      const session = await mongoose.startSession();
      try {
        session.startTransaction();

        const auditEntry = new AuditLogModel({
          actorUserId: new mongoose.Types.ObjectId(adminReq.user!.id),
          action,
          targetType: "Shop",
          targetId: shopId,
          reason: auditReason,
          requestId,
        });
        await auditEntry.save({ session });

        const updatedShop = await ShopModel.findOneAndUpdate(
          { _id: shopId, status: shop.status },
          { $set: { status: appliedStatus } },
          { session, new: true }
        );

        if (!updatedShop) {
          throw new Error("CONCURRENT_STATUS_MODIFICATION");
        }

        await session.commitTransaction();
      } catch (txErr: any) {
        try {
          await session.abortTransaction();
        } catch {}
        if (txErr.message === "CONCURRENT_STATUS_MODIFICATION") {
          return sendError(res, "CONFLICT", "Status was modified by another transaction.", 409, requestId);
        }
        throw txErr;
      } finally {
        session.endSession();
      }
    } else {
      const auditEntry = new AuditLogModel({
        actorUserId: new mongoose.Types.ObjectId(adminReq.user!.id),
        action,
        targetType: "Shop",
        targetId: shopId,
        reason: auditReason,
        requestId,
      });
      await auditEntry.save();

      const updatedShop = await ShopModel.findOneAndUpdate(
        { _id: shopId, status: shop.status },
        { $set: { status: appliedStatus } },
        { new: true }
      );

      if (!updatedShop) {
        await AuditLogModel.deleteOne({ _id: auditEntry._id }).catch(() => {});
        return sendError(res, "CONFLICT", "Status was modified concurrently.", 409, requestId);
      }
    }

    return sendSuccess(
      res,
      {
        shopId: shop._id,
        requestedStatus: status,
        appliedStatus,
        note,
        updatedAt: new Date(),
      },
      undefined,
      requestId
    );
  } catch (error: any) {
    console.error(`[AdminShopStatusError] reqId: ${requestId}`, error);
    return sendError(res, "INTERNAL_ERROR", "Failed to update shop status.", 500, requestId);
  }
});