import { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import { env } from "../config/env";
import { UserModel } from "../models";

export interface AuthenticatedAdminRequest extends Request {
  requestId?: string;
  user?: {
    id: string;
    role: string;
    status: string;
    email?: string;
    name?: string;
  };
}

const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

export const adminRateLimiter = (req: Request, res: Response, next: NextFunction) => {
  const ip = req.ip || req.socket.remoteAddress || "admin_global";
  const limit = Number(process.env.ADMIN_RATE_LIMIT_PER_MIN ?? 100);
  const now = Date.now();
  const windowMs = 60 * 1000;

  for (const [key, val] of rateLimitMap.entries()) {
    if (now > val.resetAt) {
      rateLimitMap.delete(key);
    }
  }

  const current = rateLimitMap.get(ip);
  if (!current || now > current.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + windowMs });
    return next();
  }

  if (current.count >= limit) {
    const reqId = res.locals.requestId || `req_${crypto.randomUUID()}`;
    return res.status(429).json({
      error: {
        code: "RATE_LIMIT_EXCEEDED",
        message: "Too many requests to admin services. Try again in 60 seconds.",
        requestId: reqId,
      },
    });
  }

  current.count++;
  next();
};

export const requireAdmin = async (req: Request, res: Response, next: NextFunction) => {
  const adminReq = req as AuthenticatedAdminRequest;
  const reqId = res.locals.requestId || (req as any).requestId || `req_${crypto.randomUUID()}`;
  adminReq.requestId = reqId;
  res.setHeader("x-request-id", reqId);

  const authHeader = (adminReq.headers.authorization || "").trim();
  const cookies = (req as any).cookies || {};
  
  // Dev 3 ke exact dbi_token cookie ko pehle check kiya gaya hai
  const cookieToken =
    cookies.dbi_token || cookies.accessToken || cookies.token || cookies.access_token || cookies.jwt;
  const rawToken = authHeader.startsWith("Bearer ") ? authHeader.split(" ")[1] : cookieToken;

  // 1. JWT verification check
  if (rawToken) {
    const secret = (env as any).jwtAccessSecret || process.env.JWT_ACCESS_SECRET;

    if (!secret) {
      console.error(`[AdminAuthConfigError] reqId: ${reqId} JWT access secret not configured.`);
      return res.status(503).json({
        error: {
          code: "SERVICE_UNAVAILABLE",
          message: "Authentication service is not properly configured.",
          requestId: reqId,
        },
      });
    }

    let decoded: any;
    try {
      decoded = jwt.verify(rawToken, secret);
    } catch {
      return res.status(401).json({
        error: {
          code: "UNAUTHORIZED",
          message: "Invalid or expired administrative token.",
          requestId: reqId,
        },
      });
    }

    const userId = decoded.userId || decoded.id || decoded.sub;
    if (userId) {
      try {
        const dbUser: any = await UserModel.findById(userId).select("role status email name").lean();
        if (dbUser) {
          adminReq.user = {
            id: String(dbUser._id),
            role: dbUser.role,
            status: dbUser.status,
            email: dbUser.email,
            name: dbUser.name,
          };
        }
      } catch (dbErr) {
        console.error(`[AdminAuthDatabaseError] reqId: ${reqId}`, dbErr);
        return res.status(503).json({
          error: {
            code: "SERVICE_UNAVAILABLE",
            message: "Authentication service temporarily unavailable.",
            requestId: reqId,
          },
        });
      }
    }
  }

  // (There is no mock or test-token login: every administrator is a real user in the database.)

  // 2. Unauthenticated -> 401
  if (!adminReq.user || !adminReq.user.id) {
    return res.status(401).json({
      error: {
        code: "UNAUTHORIZED",
        message: "Authentication session required.",
        requestId: reqId,
      },
    });
  }

  // 3. Role mismatch -> 403
  if (adminReq.user.role !== "PLATFORM_ADMIN") {
    return res.status(403).json({
      error: {
        code: "FORBIDDEN",
        message: "Super admin access required.",
        requestId: reqId,
      },
    });
  }

  // 4. Account suspended -> 403
  if (adminReq.user.status === "SUSPENDED") {
    return res.status(403).json({
      error: {
        code: "FORBIDDEN",
        message: "Account suspended. Please contact platform management.",
        requestId: reqId,
      },
    });
  }

  next();
};

export const sendSuccess = (
  res: Response,
  data: any,
  meta?: any,
  requestId?: string,
  statusCode = 200
) => {
  return res.status(statusCode).json({
    data,
    ...(meta ? { meta } : {}),
    requestId: requestId || res.locals.requestId || `req_${crypto.randomUUID()}`,
  });
};

export const sendError = (
  res: Response,
  code: string,
  message: string,
  statusCode = 400,
  requestId?: string
) => {
  return res.status(statusCode).json({
    error: {
      code,
      message,
      requestId: requestId || res.locals.requestId || `req_${crypto.randomUUID()}`,
    },
  });
};