// src/utils/jwt.ts
// Owner: Lead

import jwt, { SignOptions, JwtPayload } from "jsonwebtoken";
import { env } from "../config/env";

export interface AccessTokenPayload {
  sub: string; // user UUID
  role: "user" | "provider" | "admin";
  phone: string;
}

export interface RefreshTokenPayload {
  sub: string;
  tokenFamily: string; // rotation family for refresh token reuse detection
}

// ── Sign ─────────────────────────────────────────────────────────────────────

export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    expiresIn: env.JWT_ACCESS_EXPIRES_IN,
    issuer: "roundu",
    audience: "roundu-client",
  } as SignOptions);
}

export function signRefreshToken(payload: RefreshTokenPayload): string {
  return jwt.sign(payload, env.JWT_REFRESH_SECRET, {
    expiresIn: env.JWT_REFRESH_EXPIRES_IN,
    issuer: "roundu",
    audience: "roundu-client",
  } as SignOptions);
}

// ── Verify ────────────────────────────────────────────────────────────────────

export function verifyAccessToken(token: string): AccessTokenPayload & JwtPayload {
  return jwt.verify(token, env.JWT_ACCESS_SECRET, {
    issuer: "roundu",
    audience: "roundu-client",
  }) as AccessTokenPayload & JwtPayload;
}

export function verifyRefreshToken(token: string): RefreshTokenPayload & JwtPayload {
  return jwt.verify(token, env.JWT_REFRESH_SECRET, {
    issuer: "roundu",
    audience: "roundu-client",
  }) as RefreshTokenPayload & JwtPayload;
}

// ── Decode without verify (for logging only) ──────────────────────────────────

export function decodeToken(token: string): JwtPayload | null {
  return jwt.decode(token) as JwtPayload | null;
}