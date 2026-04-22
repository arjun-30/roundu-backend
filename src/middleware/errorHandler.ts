// Owner: Lead
// Purpose: Central Express error handler — normalises all thrown errors into the
//          standard { success, error: { code, message, details } } envelope.

import { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";
import { isDev } from "../config/env";
import { logger } from "../utils/logger";

// ── Custom app error ──────────────────────────────────────────────────────────

export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "AppError";
    Error.captureStackTrace(this, this.constructor);
  }
}

// ── Factories ─────────────────────────────────────────────────────────────────

export const Errors = {
  badRequest: (message: string, details?: Record<string, unknown>) =>
    new AppError(400, "VALIDATION_ERROR", message, details),

  unauthorized: (message = "Unauthorized") =>
    new AppError(401, "UNAUTHORIZED", message),

  forbidden: (message = "Forbidden") =>
    new AppError(403, "FORBIDDEN", message),

  notFound: (resource = "Resource") =>
    new AppError(404, "NOT_FOUND", `${resource} not found`),

  conflict: (message: string) =>
    new AppError(409, "CONFLICT", message),

  unprocessable: (message: string, details?: Record<string, unknown>) =>
    new AppError(422, "UNPROCESSABLE", message, details),

  internal: (message = "Internal server error") =>
    new AppError(500, "INTERNAL_ERROR", message),
};

// ── Zod → AppError helper ─────────────────────────────────────────────────────

function formatZodError(err: ZodError): AppError {
  const details = Object.fromEntries(
    err.issues.map((issue) => [issue.path.join("."), issue.message])
  );
  return Errors.badRequest("Validation failed", details);
}

// ── Knex / Postgres error codes ───────────────────────────────────────────────

interface DbError extends Error {
  code?: string;
  constraint?: string;
}

function formatDbError(err: DbError): AppError {
  switch (err.code) {
    case "23505": // unique_violation
      return Errors.conflict(
        err.constraint
          ? `Duplicate value on constraint: ${err.constraint}`
          : "Duplicate value"
      );
    case "23503": // foreign_key_violation
      return Errors.badRequest("Referenced resource does not exist");
    case "22P02": // invalid_text_representation
      return Errors.badRequest("Invalid UUID or enum value");
    default:
      return Errors.internal();
  }
}

// ── Main handler ──────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  // Normalise to AppError
  let appError: AppError;

  if (err instanceof AppError) {
    appError = err;
  } else if (err instanceof ZodError) {
    appError = formatZodError(err);
  } else if (
    err instanceof Error &&
    "code" in err &&
    typeof (err as DbError).code === "string" &&
    // Postgres SQLSTATE codes are 5 alphanumeric chars (e.g. 22P02, 23505)
    (err as DbError).code!.match(/^[0-9A-Z]{5}$/)
  ) {
    appError = formatDbError(err as DbError);
  } else if (
    err instanceof Error &&
    "statusCode" in err &&
    typeof (err as { statusCode?: unknown }).statusCode === "number"
  ) {
    // Services throw plain errors with statusCode/code attached — normalize.
    const e = err as Error & { statusCode: number; code?: string; details?: Record<string, unknown> };
    appError = new AppError(e.statusCode, e.code ?? "ERROR", e.message, e.details);
  } else {
    // Unknown — log fully, surface safely
    logger.error("Unhandled error", { err, path: req.path, method: req.method });
    appError = Errors.internal();
  }

  // Log 5xx errors with stack in dev
  if (appError.statusCode >= 500) {
    logger.error(appError.message, {
      statusCode: appError.statusCode,
      path: req.path,
    });
    if (isDev && err instanceof Error) {
      console.error(err.stack);
    }
  }

  res.status(appError.statusCode).json({
    success: false,
    error: {
      code: appError.code,
      message: appError.message,
      ...(appError.details ? { details: appError.details } : {}),
    },
  });
}

// ── 404 catch-all (register before errorHandler) ──────────────────────────────

export function notFoundHandler(req: Request, _res: Response, next: NextFunction): void {
  next(Errors.notFound(`Route ${req.method} ${req.path}`));
}