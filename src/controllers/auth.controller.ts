// src/controllers/auth.controller.ts
// Owner: Lead

import { Request, Response, NextFunction } from "express";
import { randomUUID } from "crypto";
import { db } from "../config/database";
import { redis } from "../config/redis";
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from "../utils/jwt";
import { Errors } from "../middleware/errorHandler";
import { sendOtp, verifyOtp as checkOtp } from "../services/msg91.service";
import { ok, created } from "../utils/response";

const REFRESH_PREFIX = "refresh:";
const OTP_COOLDOWN   = 60; // seconds

// ── POST /api/auth/register ───────────────────────────────────────────────────

export async function register(req: Request, res: Response, next: NextFunction) {
  try {
    const { phone, name, role = "user" } = req.body;

    const existing = await db("users").where({ phone }).first();
    if (existing) throw Errors.conflict("Phone number already registered");

    const userId = randomUUID();

    await db("users").insert({
      id:         userId,
      phone,
      name,
      role,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });

    // If registering as provider, seed provider row
    if (role === "provider") {
      await db("providers").insert({
        id:           randomUUID(),
        user_id:      userId,
        is_available: false,
        created_at:   db.fn.now(),
        updated_at:   db.fn.now(),
      });
    }

    await _sendOtpWithCooldown(phone);

    return created(res, null, "OTP sent — verify your phone to complete registration");
  } catch (err) {
    next(err);
  }
}

// ── POST /api/auth/login ──────────────────────────────────────────────────────

export async function login(req: Request, res: Response, next: NextFunction) {
  try {
    const { phone } = req.body;

    const user = await db("users").where({ phone }).first();
    if (!user) throw Errors.notFound("User");

    await _sendOtpWithCooldown(phone);

    return ok(res, null, "OTP sent");
  } catch (err) {
    next(err);
  }
}

// ── POST /api/auth/verify-otp ─────────────────────────────────────────────────

export async function verifyOtp(req: Request, res: Response, next: NextFunction) {
  try {
    const { phone, otp } = req.body;

    const valid = await checkOtp(phone, otp);
    if (!valid) throw Errors.unauthorized("Invalid or expired OTP");

    const user = await db("users").where({ phone }).first();
    if (!user) throw Errors.notFound("User");

    const tokenFamily = randomUUID();
    const accessToken  = signAccessToken({ sub: user.id, role: user.role, phone });
    const refreshToken = signRefreshToken({ sub: user.id, tokenFamily });

    // Store refresh token in Redis (hashed key → userId)
    await redis.set(
      `${REFRESH_PREFIX}${tokenFamily}`,
      user.id,
      "EX",
      30 * 24 * 60 * 60 // 30 days
    );

    return ok(res, {
      accessToken,
      refreshToken,
      user: _safeUser(user),
    });
  } catch (err) {
    next(err);
  }
}

// ── POST /api/auth/refresh ────────────────────────────────────────────────────

export async function refresh(req: Request, res: Response, next: NextFunction) {
  try {
    const { refreshToken } = req.body;

    let payload;
    try {
      payload = verifyRefreshToken(refreshToken);
    } catch {
      throw Errors.unauthorized("Invalid or expired refresh token");
    }

    const redisKey = `${REFRESH_PREFIX}${payload.tokenFamily}`;
    const storedId = await redis.get(redisKey);

    if (!storedId || storedId !== payload.sub) {
      // Possible token reuse — invalidate entire family
      await redis.del(redisKey);
      throw Errors.unauthorized("Refresh token reuse detected — please log in again");
    }

    const user = await db("users").where({ id: payload.sub }).first();
    if (!user) throw Errors.notFound("User");

    // Rotate: delete old, issue new family
    await redis.del(redisKey);
    const newFamily       = randomUUID();
    const newAccessToken  = signAccessToken({ sub: user.id, role: user.role, phone: user.phone });
    const newRefreshToken = signRefreshToken({ sub: user.id, tokenFamily: newFamily });

    await redis.set(
      `${REFRESH_PREFIX}${newFamily}`,
      user.id,
      "EX",
      30 * 24 * 60 * 60
    );

    return ok(res, { accessToken: newAccessToken, refreshToken: newRefreshToken });
  } catch (err) {
    next(err);
  }
}

// ── POST /api/auth/logout ─────────────────────────────────────────────────────

export async function logout(req: Request, res: Response, next: NextFunction) {
  try {
    const { refreshToken } = req.body;

    try {
      const payload = verifyRefreshToken(refreshToken);
      await redis.del(`${REFRESH_PREFIX}${payload.tokenFamily}`);
    } catch {
      // Already expired — still respond 200, nothing to revoke
    }

    return ok(res, null, "Logged out");
  } catch (err) {
    next(err);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function _sendOtpWithCooldown(phone: string) {
  const cooldownKey = `otp_cooldown:${phone}`;
  const onCooldown  = await redis.get(cooldownKey);
  if (onCooldown) {
    throw Errors.badRequest(`Please wait ${OTP_COOLDOWN}s before requesting another OTP`);
  }

  await sendOtp(phone);
  await redis.set(cooldownKey, "1", "EX", OTP_COOLDOWN);
}

function _safeUser(user: Record<string, unknown>) {
  const { password_hash, ...safe } = user;
  void password_hash;
  return safe;
}