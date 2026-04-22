// src/validators/auth.validator.ts
// Owner: Lead

import { z } from "zod";

export const registerSchema = z.object({
  body: z.object({
    phone: z
      .string()
      .regex(/^\+?[1-9]\d{7,14}$/, "Invalid phone number"),
    name:  z.string().min(2).max(100),
    role:  z.enum(["user", "provider"]).optional(),
  }),
});

export const loginSchema = z.object({
  body: z.object({
    phone: z.string().min(1, "Phone is required"),
  }),
});

export const verifyOtpSchema = z.object({
  body: z.object({
    phone: z.string().min(1),
    otp:   z.string().length(6, "OTP must be 6 digits").regex(/^\d+$/),
  }),
});

export const refreshSchema = z.object({
  body: z.object({
    refreshToken: z.string().min(1, "refreshToken is required"),
  }),
});

export const logoutSchema = z.object({
  body: z.object({
    refreshToken: z.string().min(1, "refreshToken is required"),
  }),
});