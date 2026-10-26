import { Router, Request, Response, NextFunction } from "express";
import { shopSchema } from "@dbi/validation";
import { ShopModel } from "../../../models";
import { authenticate, requireShopAccess } from "../../../middleware/auth";

export const shopsRouter = Router();

function formatShop(s: any) {
  return {
    id: s._id.toString(),
    ownerId: s.ownerId.toString(),
    name: s.name,
    timezone: s.timezone,
    address: s.address,
    status: s.status,
    demo: s.demo,
    createdAt: s.createdAt?.toISOString(),
  };
}

// POST /api/v1/shops
shopsRouter.post("/", authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parseResult = shopSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        error: {
          code: "VALIDATION_ERROR",
          message: parseResult.error.errors[0]?.message ?? "Invalid shop data",
          requestId: req.requestId,
        },
      });
      return;
    }

    const { name, timezone, address } = parseResult.data;
    const shop = await ShopModel.create({
      ownerId: req.user!.id,
      name,
      timezone: timezone ?? "Asia/Kolkata",
      address,
      status: "PENDING_SETUP",
    });

    res.status(201).json({
      data: {
        shop: formatShop(shop),
      },
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/shops
shopsRouter.get("/", authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const query = req.user!.role === "SUPER_ADMIN" ? {} : { ownerId: req.user!.id };
    const shops = await ShopModel.find(query).sort({ createdAt: -1 });

    res.json({
      data: {
        items: shops.map(formatShop),
      },
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/shops/:shopId
shopsRouter.get(
  "/:shopId",
  authenticate,
  requireShopAccess,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const shop = await ShopModel.findById(req.params.shopId);
      if (!shop) {
        res.status(404).json({
          error: {
            code: "NOT_FOUND",
            message: "Shop not found.",
            requestId: req.requestId,
          },
        });
        return;
      }

      res.json({
        data: {
          shop: formatShop(shop),
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

// PATCH /api/v1/shops/:shopId
shopsRouter.patch(
  "/:shopId",
  authenticate,
  requireShopAccess,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { name, timezone, address } = req.body;
      const shop = await ShopModel.findById(req.params.shopId);
      if (!shop) {
        res.status(404).json({
          error: {
            code: "NOT_FOUND",
            message: "Shop not found.",
            requestId: req.requestId,
          },
        });
        return;
      }

      if (name) shop.name = name;
      if (timezone) shop.timezone = timezone;
      if (address) shop.address = { ...shop.address, ...address };

      await shop.save();

      res.json({
        data: {
          shop: formatShop(shop),
        },
      });
    } catch (err) {
      next(err);
    }
  }
);
