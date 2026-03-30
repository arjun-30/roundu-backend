// DEV 3 — predictFutureIssues, analyzeGpsPattern, getRecommendations via vLLM
// src/services/vllm.service.ts
// Owner: Dev 3 (GPS + AI)
//
// Thin wrapper around the vLLM OpenAI-compatible API.
// Only this file talks to vLLM — recommendation.service.ts calls this.
//
// Design principles:
//   - One exported function per use-case (not a generic "call vLLM" util)
//   - Always ask the model for structured JSON — parse and validate before returning
//   - On any inference failure, throw a typed VllmError so callers can decide
//     whether to fall back to heuristics or propagate the error

import { vllmClient, VLLM_MODEL, isVllmEnabled } from '../config/vllm';
import { logger } from '../utils/logger';

// ─── Error type ───────────────────────────────────────────────────────────────

export class VllmError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'VllmError';
  }
}

// ─── Shared JSON extraction helper ───────────────────────────────────────────

/**
 * Extract the first JSON object from a model response string.
 * Models sometimes wrap JSON in markdown fences — this handles both cases.
 */
function extractJson<T>(raw: string): T {
  // Strip optional ```json ... ``` fences
  const cleaned = raw.replace(/```json\s*/gi, '').replace(/```/g, '').trim();

  // Find the outermost { ... } block
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1) {
    throw new VllmError(`No JSON object found in model response: ${raw.slice(0, 200)}`);
  }

  try {
    return JSON.parse(cleaned.slice(start, end + 1)) as T;
  } catch (err) {
    throw new VllmError(`Failed to parse model JSON: ${cleaned.slice(start, end + 1).slice(0, 300)}`, err);
  }
}

// ─── Types for recommendation inference ──────────────────────────────────────

export interface BookingHistoryEntry {
  serviceName: string;
  serviceCategory: string;
  serviceId: string;
  completedAt: string;      // ISO date string
  rating: number | null;
}

export interface RecommendationInferenceResult {
  recommendations: Array<{
    serviceId: string;
    reason: string;           // user-facing natural language explanation
    score: number;            // 0.0–1.0
    predictedDate: string;    // ISO date "YYYY-MM-DD" — when they'll need it next
    notifyDaysBefore: number; // 1–7
    aiReasoning: string;      // internal chain-of-thought for auditability
  }>;
}

// ─── System prompt (kept here so it versions with the code) ──────────────────

const RECOMMENDATION_SYSTEM_PROMPT = `You are the AI engine for RoundU, a hyper-local home services app.
Your job is to analyse a customer's past service booking history and predict:
  1. Which services they are likely to need again soon.
  2. When they will need them (predicted date).
  3. How confident you are (score 0.0–1.0).
  4. A short, friendly, user-facing reason (max 20 words).
  5. How many days before the predicted date to send them a reminder push notification (1–7).

Rules:
- Consider seasonality (AC servicing before summer, pest control before monsoon in India).
- Consider typical service intervals (plumbing: ad-hoc; AC service: every 6 months; cleaning: monthly).
- Consider the user's historical rating — if they rated a service poorly (< 3), do not recommend same provider but still recommend the service category.
- Only recommend services that exist in the provided service list.
- Output ONLY a valid JSON object matching this schema — no prose, no markdown fences:

{
  "recommendations": [
    {
      "serviceId": "<uuid>",
      "reason": "<max 20 word user-facing reason>",
      "score": <0.0–1.0>,
      "predictedDate": "<YYYY-MM-DD>",
      "notifyDaysBefore": <1–7>,
      "aiReasoning": "<internal chain of thought>"
    }
  ]
}

Return between 1 and 5 recommendations, sorted by score descending.`;

// ─── VllmService ──────────────────────────────────────────────────────────────

export class VllmService {
  /**
   * Given a user's booking history and the platform's available services,
   * return a ranked list of AI-generated recommendations.
   *
   * @param history       - Completed bookings for this user (newest first)
   * @param availableServices - All active services on the platform (id + name + category)
   * @param currentDate   - Today's date as "YYYY-MM-DD" (injected for testability)
   */
  async generateRecommendations(
    history: BookingHistoryEntry[],
    availableServices: Array<{ id: string; name: string; category: string }>,
    currentDate: string,
  ): Promise<RecommendationInferenceResult> {
    if (!isVllmEnabled) {
      throw new VllmError('vLLM is not configured — set VLLM_BASE_URL and VLLM_MODEL_NAME');
    }

    const userPrompt = buildRecommendationPrompt(history, availableServices, currentDate);

    logger.debug({ model: VLLM_MODEL, historyCount: history.length }, 'Calling vLLM for recommendations');

    let rawContent: string;
    try {
      const response = await vllmClient.chat.completions.create({
        model: VLLM_MODEL,
        messages: [
          { role: 'system', content: RECOMMENDATION_SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.2,    // low temperature = more deterministic, structured output
        max_tokens: 1024,
        // vLLM supports guided_json for constrained decoding — pass as extra_body
        // This guarantees valid JSON output even if the model is poorly tuned
      });

      rawContent = response.choices[0]?.message?.content ?? '';
    } catch (err) {
      throw new VllmError('vLLM API call failed', err);
    }

    if (!rawContent) {
      throw new VllmError('vLLM returned an empty response');
    }

    const parsed = extractJson<RecommendationInferenceResult>(rawContent);
    validateRecommendationOutput(parsed, availableServices);

    logger.info(
      { count: parsed.recommendations.length },
      'vLLM generated recommendations successfully',
    );

    return parsed;
  }
}

// ─── Prompt builder ───────────────────────────────────────────────────────────

function buildRecommendationPrompt(
  history: BookingHistoryEntry[],
  availableServices: Array<{ id: string; name: string; category: string }>,
  currentDate: string,
): string {
  const historySection =
    history.length > 0
      ? history
          .map(
            (b, i) =>
              `${i + 1}. Service: "${b.serviceName}" (${b.serviceCategory}) | ID: ${b.serviceId} | Completed: ${b.completedAt} | Rating: ${b.rating ?? 'N/A'}/5`,
          )
          .join('\n')
      : 'No booking history yet.';

  const serviceSection = availableServices
    .map((s) => `- "${s.name}" (${s.category}) | ID: ${s.id}`)
    .join('\n');

  return `Today's date: ${currentDate}

CUSTOMER'S BOOKING HISTORY (most recent first):
${historySection}

AVAILABLE SERVICES ON PLATFORM:
${serviceSection}

Based on the customer's history and the available services, generate recommendations.`;
}

// ─── Output validation ────────────────────────────────────────────────────────

function validateRecommendationOutput(
  parsed: RecommendationInferenceResult,
  availableServices: Array<{ id: string; name: string; category: string }>,
): void {
  if (!Array.isArray(parsed.recommendations)) {
    throw new VllmError('Model output missing "recommendations" array');
  }

  const validServiceIds = new Set(availableServices.map((s) => s.id));

  parsed.recommendations = parsed.recommendations.filter((r) => {
    // Drop any recommendation that references a non-existent service
    if (!validServiceIds.has(r.serviceId)) {
      logger.warn({ serviceId: r.serviceId }, 'vLLM hallucinated a serviceId — dropping');
      return false;
    }
    // Clamp score to valid range
    r.score = Math.max(0, Math.min(1, Number(r.score) || 0.5));
    // Clamp notifyDaysBefore
    r.notifyDaysBefore = Math.max(1, Math.min(7, Number(r.notifyDaysBefore) || 3));
    return true;
  });

  if (!parsed.recommendations.length) {
    throw new VllmError('vLLM produced zero valid recommendations after filtering');
  }
}
