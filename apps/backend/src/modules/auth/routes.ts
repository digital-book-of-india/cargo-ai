import { Router, Request, Response, NextFunction } from "express";
import { registerSchema, loginSchema, updateProfileSchema } from "@dbi/validation";
import { UserModel } from "../../models";
import { hashPassword, comparePassword, signAccessToken } from "../../utils/auth";
import { authenticate } from "../../middleware/auth";
import { authRateLimiter } from "../../middleware/rateLimiter";

export const authRouter = Router();

// POST /api/v1/auth/register
authRouter.post("/register", authRateLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parseResult = registerSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        error: {
          code: "VALIDATION_ERROR",
          message: parseResult.error.errors[0]?.message ?? "Invalid registration data",
          requestId: req.requestId,
        },
      });
      return;
    }

    const { name, email, password } = parseResult.data;
    const existing = await UserModel.findOne({ email: email.toLowerCase() });
    if (existing) {
      res.status(409).json({
        error: {
          code: "CONFLICT",
          message: "An account with this email already exists.",
          requestId: req.requestId,
        },
      });
      return;
    }

    const passwordHash = await hashPassword(password);
    const user = await UserModel.create({
      name,
      email: email.toLowerCase(),
      passwordHash,
      role: "SHOP_OWNER",
      status: "ACTIVE",
    });

    const token = signAccessToken({
      id: user._id.toString(),
      email: user.email,
      role: user.role,
    });

    res.cookie("dbi_token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    res.status(201).json({
      data: {
        user: {
          id: user._id.toString(),
          name: user.name,
          email: user.email,
          role: user.role,
          status: user.status,
          createdAt: user.createdAt.toISOString(),
        },
        token,
      },
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/auth/login
authRouter.post("/login", authRateLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parseResult = loginSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        error: {
          code: "VALIDATION_ERROR",
          message: parseResult.error.errors[0]?.message ?? "Invalid login data",
          requestId: req.requestId,
        },
      });
      return;
    }

    const { email, password } = parseResult.data;
    const user = await UserModel.findOne({ email: email.toLowerCase() });
    if (!user) {
      res.status(401).json({
        error: {
          code: "UNAUTHORIZED",
          message: "Invalid email or password.",
          requestId: req.requestId,
        },
      });
      return;
    }

    if (user.status === "SUSPENDED") {
      res.status(403).json({
        error: {
          code: "ACCOUNT_SUSPENDED",
          message: "This account has been suspended. Please contact support.",
          requestId: req.requestId,
        },
      });
      return;
    }

    const isMatch = await comparePassword(password, user.passwordHash);
    if (!isMatch) {
      res.status(401).json({
        error: {
          code: "UNAUTHORIZED",
          message: "Invalid email or password.",
          requestId: req.requestId,
        },
      });
      return;
    }

    const token = signAccessToken({
      id: user._id.toString(),
      email: user.email,
      role: user.role,
    });

    res.cookie("dbi_token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    res.json({
      data: {
        user: {
          id: user._id.toString(),
          name: user.name,
          email: user.email,
          role: user.role,
          status: user.status,
          createdAt: user.createdAt.toISOString(),
        },
        token,
      },
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/auth/logout
authRouter.post("/logout", (req: Request, res: Response) => {
  res.clearCookie("dbi_token");
  res.json({ data: { message: "Logged out successfully" } });
});

// GET /api/v1/auth/me
authRouter.get("/me", authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = await UserModel.findById(req.user!.id);
    if (!user) {
      res.status(404).json({
        error: {
          code: "NOT_FOUND",
          message: "User not found.",
          requestId: req.requestId,
        },
      });
      return;
    }

    res.json({
      data: {
        user: {
          id: user._id.toString(),
          name: user.name,
          email: user.email,
          role: user.role,
          status: user.status,
          createdAt: user.createdAt.toISOString(),
        },
      },
    });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/v1/auth/me
authRouter.patch("/me", authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parseResult = updateProfileSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        error: {
          code: "VALIDATION_ERROR",
          message: parseResult.error.errors[0]?.message ?? "Invalid profile data",
          requestId: req.requestId,
        },
      });
      return;
    }

    const user = await UserModel.findById(req.user!.id);
    if (!user) {
      res.status(404).json({
        error: {
          code: "NOT_FOUND",
          message: "User not found.",
          requestId: req.requestId,
        },
      });
      return;
    }

    if (parseResult.data.name) {
      user.name = parseResult.data.name;
      await user.save();
    }

    res.json({
      data: {
        user: {
          id: user._id.toString(),
          name: user.name,
          email: user.email,
          role: user.role,
          status: user.status,
          createdAt: user.createdAt.toISOString(),
        },
      },
    });
  } catch (err) {
    next(err);
  }
});
