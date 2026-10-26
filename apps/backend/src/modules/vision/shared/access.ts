import type { Request } from "express";
import { ShopModel } from "../../../models";
import { AppError } from "../../../middleware/errorHandler";

// STUB for Dev 1's tenancy middleware, same signature:
//   assertShopAccess(req, shopId) resolves if the user may act on this site, otherwise throws.
// Denials return 404 (not 403) so other companies' site IDs are not revealed (spec QA-01).
// Replace the body with Dev 1's implementation when it lands.
export async function assertShopAccess(req: Request, shopId: string): Promise<void> {
  if (!req.user) throw new AppError(401, "UNAUTHORIZED", "Authentication required.");
  if (req.user.role === "SUPER_ADMIN") return;

  const shop = await ShopModel.findById(shopId).select("ownerId").lean();
  if (!shop || String(shop.ownerId) !== req.user.id) {
    throw new AppError(404, "NOT_FOUND", "Site not found.");
  }
}