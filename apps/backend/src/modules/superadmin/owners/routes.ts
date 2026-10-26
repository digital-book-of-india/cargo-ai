import { Router, Request, Response } from "express";
import { requireAdmin, adminRateLimiter, sendSuccess, sendError, AuthenticatedAdminRequest } from "../../../middleware/adminAuth";
import { UserModel } from "../../../models";
import { parsePagination, escapeRegex, sanitizeString } from "../../../utils/adminHelpers";

export const adminOwnersRouter = Router();

adminOwnersRouter.use(adminRateLimiter);
adminOwnersRouter.use(requireAdmin);

const VALID_STATUSES = ["ACTIVE", "SUSPENDED", "PENDING_VERIFICATION"];

adminOwnersRouter.get("/", async (req: Request, res: Response) => {
  const adminReq = req as AuthenticatedAdminRequest;
  const requestId = adminReq.requestId;
  try {
    const { page, limit, skip } = parsePagination(req.query);
    const search = sanitizeString(req.query.search);
    const status = sanitizeString(req.query.status);

    const matchQuery: any = { role: "SHOP_OWNER" };

    if (search) {
      const safeRegex = new RegExp(escapeRegex(search), "i");
      matchQuery.$or = [{ name: safeRegex }, { email: safeRegex }];
    }

    if (status && status !== "ALL") {
      if (!VALID_STATUSES.includes(status)) {
        return sendError(res, "INVALID_QUERY", "Invalid status query filter.", 400, requestId);
      }
      matchQuery.status = status;
    }

    const pipeline: any[] = [
      { $match: matchQuery },
      { $sort: { createdAt: -1, _id: -1 } },       {$skip: skip },
      { $limit: limit },
      {
        $lookup: {
          from: "shops",
          localField: "_id",
          foreignField: "ownerId",
          as: "shops",
        },
      },
      {
        $addFields: {
          shopCount: { $size: "$shops" },
        },
      },
      {
        $project: {
          passwordHash: 0,
          shops: 0,
        },
      },
    ];

    const [owners, totalCountResult] = await Promise.all([
      UserModel.aggregate(pipeline),
      UserModel.countDocuments(matchQuery),
    ]);

    const totalPages = Math.ceil(totalCountResult / limit);

    return sendSuccess(
      res,
      { owners },
      { page, limit, total: totalCountResult, totalPages },
      requestId
    );
  } catch (error: any) {
    console.error(`[AdminOwnersError] reqId: ${requestId}`, error);
    return sendError(res, "INTERNAL_ERROR", "Failed to fetch platform owners.", 500, requestId);
  }
});