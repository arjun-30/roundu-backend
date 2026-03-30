// TECH LEAD — vLLM inference client config
// src/config/vllm.ts
// Owner: Dev 3 (GPS + AI)
//
// vLLM exposes an OpenAI-compatible REST API, so we use the official `openai` npm
// package pointed at our self-hosted vLLM server instead of OpenAI's cloud.
//
// Required env vars:
//   VLLM_BASE_URL   — e.g. http://localhost:8000/v1
//   VLLM_MODEL_NAME — e.g. mistralai/Mistral-7B-Instruct-v0.2
//   VLLM_API_KEY    — set to any non-empty string if vLLM auth is disabled (required by SDK)

import OpenAI from 'openai';
import { logger } from '../utils/logger';

// ─── Validate required env vars at startup ────────────────────────────────────

const VLLM_BASE_URL = process.env.VLLM_BASE_URL;
const VLLM_MODEL_NAME = process.env.VLLM_MODEL_NAME;
const VLLM_API_KEY = process.env.VLLM_API_KEY ?? 'not-needed'; // vLLM ignores this

if (!VLLM_BASE_URL) {
  logger.warn('VLLM_BASE_URL is not set — AI recommendation engine will be disabled');
}
if (!VLLM_MODEL_NAME) {
  logger.warn('VLLM_MODEL_NAME is not set — AI recommendation engine will be disabled');
}

// ─── OpenAI-compatible client pointed at vLLM ────────────────────────────────

export const vllmClient = new OpenAI({
  baseURL: VLLM_BASE_URL ?? 'http://localhost:8000/v1',
  apiKey: VLLM_API_KEY,
  timeout: 60_000,   // 60 s — LLM inference can be slow on large contexts
  maxRetries: 2,
});

export const VLLM_MODEL = VLLM_MODEL_NAME ?? 'mistralai/Mistral-7B-Instruct-v0.2';

/** True if the vLLM server is configured. Used to skip AI features gracefully. */
export const isVllmEnabled = Boolean(VLLM_BASE_URL && VLLM_MODEL_NAME);
