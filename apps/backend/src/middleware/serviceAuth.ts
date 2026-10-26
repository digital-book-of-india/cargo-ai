import { Request, Response, NextFunction } from "express";
import { env } from "../config/env";

export function serviceAuth(req: Request, res: Response, next: NextFunction): void {
  const tokenHeader = req.headers["x-service-token"];
  const authHeader = req.headers.authorization;

  let token: string | undefined;
  if (typeof tokenHeader === "string") {
    token = tokenHeader;
  } else if (authHeader && authHeader.startsWith("Bearer ")) {
    token = authHeader.substring(7);
  }

  if (!token || token !== env.aiServiceToken) {
    res.status(401).json({
      error: {
        code: "UNAUTHORIZED",
        message: "Invalid or missing internal service token.",
        requestId: req.requestId,
      },
    });
    return;
  }

  req.serviceName = "ai-worker";
  next();
}
