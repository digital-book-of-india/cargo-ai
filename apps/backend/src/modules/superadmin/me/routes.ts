import { Router, Request, Response } from "express";
import { requireAdmin, sendSuccess, AuthenticatedAdminRequest } from "../../../middleware/adminAuth";

export const adminMeRouter = Router();

adminMeRouter.use(requireAdmin);

// GET /api/v1/admin/me - the signed-in platform administrator (401 not signed in, 403 not an administrator)
adminMeRouter.get("/", (req: Request, res: Response) => {
  const adminReq = req as AuthenticatedAdminRequest;
  const u = adminReq.user!;
  sendSuccess(res, { user: { id: u.id, name: u.name ?? "", email: u.email ?? "", role: u.role } }, undefined, adminReq.requestId);
});
