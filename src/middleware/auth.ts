// src/middleware/auth.ts
// Owner: Lead

import { Request, Response, NextFunction } from "express";
import { JsonWebTokenError, TokenExpiredError } from "jsonwebtoken";
import { verifyAccessToken, AccessTokenPayload } from "../utils/jwt";
import { Errors } from "./errorHandler";

// ── Augment Express Request ───────────────────────────────────────────────────

declare global {
  namespace Express {
    interface Request {
      user: AccessTokenPayload;
    }
  }
}

// ── Core bearer middleware ────────────────────────────────────────────────────

export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith("Bearer ")) {
    return next(Errors.unauthorized("Missing or malformed Authorization header"));
  }

  const token = authHeader.slice(7);

  try {
    req.user = verifyAccessToken(token);
    next();
  } catch (err) {
    if (err instanceof TokenExpiredError) {
      return next(Errors.unauthorized("Access token expired"));
    }
    if (err instanceof JsonWebTokenError) {
      return next(Errors.unauthorized("Invalid access token"));
    }
    next(err);
  }
}

// ── Role guards ───────────────────────────────────────────────────────────────

export function requireRole(...roles: Array<"user" | "provider" | "admin">) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      return next(Errors.unauthorized());
    }
    if (!roles.includes(req.user.role)) {
      return next(
        Errors.forbidden(`This action requires role: ${roles.join(" or ")}`)
      );
    }
    next();
  };
}

// Named shortcuts used across routes
export const requireProvider = requireRole("provider");
export const requireAdmin    = requireRole("admin");