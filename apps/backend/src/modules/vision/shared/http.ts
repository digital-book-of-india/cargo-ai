import type { NextFunction, Request, Response } from "express";
import { Types } from "mongoose";
import type { ZodError, ZodTypeAny } from "zod";
import { AppError } from "../../../middleware/errorHandler";

// Lets async handlers throw; errors go to the global errorHandler.
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res, next).catch(next);
  };
}

export function parseObjectId(value: unknown, field: string): Types.ObjectId {
  if (typeof value !== "string" || !Types.ObjectId.isValid(value)) {
    throw new AppError(400, "VALIDATION_ERROR", `${field} must be a valid id.`);
  }
  return new Types.ObjectId(value);
}

function firstZodMessage(err: ZodError): string {
  return err.errors[0]?.message ?? "Invalid request.";
}

export function parseOrThrow<T extends ZodTypeAny>(schema: T, body: unknown): T["_output"] {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new AppError(400, "VALIDATION_ERROR", firstZodMessage(result.error));
  }
  return result.data;
}

export function parseLimit(raw: unknown, fallback = 50, max = 100): number {
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    throw new AppError(400, "VALIDATION_ERROR", "limit must be a positive integer.");
  }
  return Math.min(n, max);
}