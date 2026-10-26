import { Request, Response, NextFunction } from "express";
import { Role } from "@dbi/api-types";
import { verifyAccessToken } from "../utils/auth";
import { ShopModel, CameraModel } from "../models";

export function authenticate(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  let token: string | undefined;

  if (authHeader && authHeader.startsWith("Bearer ")) {
    token = authHeader.substring(7);
  } else if (req.headers.cookie) {
    const cookies = Object.fromEntries(
      req.headers.cookie.split(";").map((c) => {
        const [k, ...v] = c.trim().split("=");
        return [k, v.join("=")];
      })
    );
    token = cookies["dbi_token"];
  }

  if (!token) {
    res.status(401).json({
      error: {
        code: "UNAUTHORIZED",
        message: "Authentication token missing.",
        requestId: req.requestId,
      },
    });
    return;
  }

  const payload = verifyAccessToken(token);
  if (!payload) {
    res.status(401).json({
      error: {
        code: "UNAUTHORIZED",
        message: "Invalid or expired token.",
        requestId: req.requestId,
      },
    });
    return;
  }

  req.user = payload;
  next();
}

export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        error: {
          code: "UNAUTHORIZED",
          message: "Authentication required.",
          requestId: req.requestId,
        },
      });
      return;
    }

    if (!roles.includes(req.user.role as Role)) {
      res.status(403).json({
        error: {
          code: "FORBIDDEN",
          message: "You do not have permission to access this resource.",
          requestId: req.requestId,
        },
      });
      return;
    }

    next();
  };
}

export async function requireShopAccess(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  if (!req.user) {
    res.status(401).json({
      error: {
        code: "UNAUTHORIZED",
        message: "Authentication required.",
        requestId: req.requestId,
      },
    });
    return;
  }

  const shopId = req.params.shopId;
  if (!shopId) {
    next();
    return;
  }

  if (req.user.role === "SUPER_ADMIN") {
    next();
    return;
  }

  try {
    const shop = await ShopModel.findById(shopId).select("ownerId");
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

    if (shop.ownerId.toString() !== req.user.id) {
      res.status(403).json({
        error: {
          code: "FORBIDDEN",
          message: "You do not have access to this shop.",
          requestId: req.requestId,
        },
      });
      return;
    }

    next();
  } catch (err) {
    next(err);
  }
}

export async function requireCameraAccess(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  if (!req.user) {
    res.status(401).json({
      error: {
        code: "UNAUTHORIZED",
        message: "Authentication required.",
        requestId: req.requestId,
      },
    });
    return;
  }

  const cameraId = req.params.cameraId;
  if (!cameraId) {
    next();
    return;
  }

  if (req.user.role === "SUPER_ADMIN") {
    next();
    return;
  }

  try {
    const camera = await CameraModel.findById(cameraId).select("shopId");
    if (!camera) {
      res.status(404).json({
        error: {
          code: "NOT_FOUND",
          message: "Camera not found.",
          requestId: req.requestId,
        },
      });
      return;
    }

    const shop = await ShopModel.findById(camera.shopId).select("ownerId");
    if (!shop) {
      res.status(404).json({
        error: {
          code: "NOT_FOUND",
          message: "Shop for camera not found.",
          requestId: req.requestId,
        },
      });
      return;
    }

    if (shop.ownerId.toString() !== req.user.id) {
      res.status(403).json({
        error: {
          code: "FORBIDDEN",
          message: "You do not have access to this camera.",
          requestId: req.requestId,
        },
      });
      return;
    }

    next();
  } catch (err) {
    next(err);
  }
}

