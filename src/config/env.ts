// Owner: Lead
// Purpose: Centralised env validation — fails fast at startup if required vars are missing

import { z } from "zod";
import dotenv from "dotenv";

dotenv.config();

const envSchema = z.object({
  // ── Server ────────────────────────────────────────────────
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(3000),

  // ── Database ──────────────────────────────────────────────
  DATABASE_URL: z.string().url(),
  DATABASE_POOL_MIN: z.coerce.number().default(2),
  DATABASE_POOL_MAX: z.coerce.number().default(10),

  // ── Redis ─────────────────────────────────────────────────
  REDIS_URL: z.string().url(),

  // ── JWT ───────────────────────────────────────────────────
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ACCESS_EXPIRES_IN: z.string().default("15m"),
  JWT_REFRESH_EXPIRES_IN: z.string().default("30d"),

  // ── AWS S3 ────────────────────────────────────────────────
  AWS_REGION: z.string(),
  AWS_ACCESS_KEY_ID: z.string(),
  AWS_SECRET_ACCESS_KEY: z.string(),
  AWS_S3_BUCKET: z.string(),

  // ── Stripe ────────────────────────────────────────────────
  STRIPE_SECRET_KEY: z.string().startsWith("sk_"),
  STRIPE_WEBHOOK_SECRET: z.string().startsWith("whsec_"),

  // ── MSG91 (OTP) ───────────────────────────────────────────
  MSG91_AUTH_KEY: z.string(),
  MSG91_TEMPLATE_ID: z.string(),
  MSG91_SENDER_ID: z.string().default("ROUNDU"),

  // ── Firebase FCM ─────────────────────────────────────────
  FIREBASE_PROJECT_ID: z.string(),
  FIREBASE_CLIENT_EMAIL: z.string().email(),
  FIREBASE_PRIVATE_KEY: z.string(),

  // ── ElevenLabs ────────────────────────────────────────────
  ELEVENLABS_API_KEY: z.string(),
  ELEVENLABS_AGENT_ID: z.string(),

  // ── vLLM ──────────────────────────────────────────────────
  VLLM_BASE_URL: z.string().url(),
  VLLM_MODEL: z.string().default("mistralai/Mistral-7B-Instruct-v0.2"),

  // ── Google Maps ───────────────────────────────────────────
  GOOGLE_MAPS_API_KEY: z.string(),

  // ── DigiLocker (KYC) ──────────────────────────────────────
  DIGILOCKER_CLIENT_ID: z.string(),
  DIGILOCKER_CLIENT_SECRET: z.string(),
  DIGILOCKER_REDIRECT_URI: z.string().url(),
  DIGILOCKER_WEBHOOK_SECRET: z.string(),

  // ── App ───────────────────────────────────────────────────
  APP_URL: z.string().url().default("http://localhost:3000"),
  CORS_ORIGINS: z.string().default("http://localhost:3001"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("❌  Invalid environment variables:\n");
  parsed.error.issues.forEach((issue) => {
    console.error(`  • ${issue.path.join(".")}: ${issue.message}`);
  });
  process.exit(1);
}

export const env = parsed.data;

// Convenience derived values
export const isDev = env.NODE_ENV === "development";
export const isTest = env.NODE_ENV === "test";
export const isProd = env.NODE_ENV === "production";