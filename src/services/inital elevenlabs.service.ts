// DEV 2 — makeCall, triggerPreServiceCalls, getCallStatus via ElevenLabs
// Owner: Dev 4 — Real-time & Communications
// Purpose: ElevenLabs Conversational AI service — initiates and tracks auto-calls

import { elevenLabsClient, elevenLabsConfig, ElevenLabsAgentType } from '../config/elevenlabs';
import CallLog, { CallDirection, CallStatus, CallOutcome } from '../models/call-log.model';
import { logger } from '../utils/logger';

export interface InitiateCallOptions {
  bookingId: string;
  callerId: string;        // DB user/provider ID (UUID)
  phoneNumber: string;     // E.164 format, e.g. "+919876543210"
  agentType: ElevenLabsAgentType;
  direction: CallDirection;
  attemptNumber?: number;
  dynamicVariables?: Record<string, string>; // Injected into agent prompt at runtime
}

export interface CallResult {
  success: boolean;
  callLogId: string;
  conversationId?: string;
  error?: string;
}

/**
 * Initiate an outbound conversational AI call via ElevenLabs.
 * Creates a CallLog record, fires the call, and returns the result.
 */
export async function initiateCall(opts: InitiateCallOptions): Promise<CallResult> {
  const agentId = elevenLabsConfig.agents[opts.agentType];

  if (!agentId) {
    logger.error(`[ElevenLabs] Agent ID not configured for type: ${opts.agentType}`);
    return { success: false, callLogId: '', error: 'Agent not configured' };
  }

  // Persist call attempt
  const callLog = await CallLog.create({
    bookingId: opts.bookingId,
    callerId: opts.callerId,
    agentId,
    direction: opts.direction,
    phoneNumber: opts.phoneNumber,
    status: 'initiated',
    attemptNumber: opts.attemptNumber ?? 1,
  });

  try {
    // ElevenLabs: initiate outbound call using Conversational AI
    const response = await elevenLabsClient.conversationalAi.conversations.createPhone({
      agent_id: agentId,
      agent_phone_number_id: process.env.ELEVENLABS_PHONE_NUMBER_ID!,
      to_number: opts.phoneNumber,
      // Inject runtime context into the agent's first turn
      conversation_config_override: opts.dynamicVariables
        ? {
            agent: {
              first_message: buildFirstMessage(opts.agentType, opts.dynamicVariables),
            },
          }
        : undefined,
    });

    const conversationId: string = (response as any).conversation_id ?? '';

    await callLog.update({
      status: 'answered' as CallStatus,
      conversationId,
      answeredAt: new Date(),
    });

    logger.info(`[ElevenLabs] Call initiated — booking=${opts.bookingId} conv=${conversationId}`);
    return { success: true, callLogId: callLog.id, conversationId };

  } catch (err: any) {
    logger.error(`[ElevenLabs] Call failed — booking=${opts.bookingId}`, err);

    await callLog.update({
      status: 'failed' as CallStatus,
      outcome: 'error' as CallOutcome,
      endedAt: new Date(),
    });

    return { success: false, callLogId: callLog.id, error: err.message };
  }
}

/**
 * Mark a call as completed and record outcome + duration.
 * Called by webhook or polling once ElevenLabs conversation ends.
 */
export async function finalizeCall(
  conversationId: string,
  outcome: CallOutcome,
  durationSeconds: number,
): Promise<void> {
  const callLog = await CallLog.findOne({ where: { conversationId } });

  if (!callLog) {
    logger.warn(`[ElevenLabs] finalizeCall — no log for conversationId=${conversationId}`);
    return;
  }

  await callLog.update({
    status: 'completed' as CallStatus,
    outcome,
    durationSeconds,
    endedAt: new Date(),
  });

  logger.info(`[ElevenLabs] Call finalized — conv=${conversationId} outcome=${outcome}`);
}

/**
 * Retry a failed call up to max attempts.
 * Returns null if max attempts exceeded.
 */
export async function retryCall(originalCallLogId: string): Promise<CallResult | null> {
  const original = await CallLog.findByPk(originalCallLogId);
  if (!original) return null;

  if (original.attemptNumber >= elevenLabsConfig.retry.maxAttempts) {
    logger.warn(`[ElevenLabs] Max retry attempts reached for booking=${original.bookingId}`);
    return null;
  }

  // Find the agent type from the agentId reverse-map
  const agentType = Object.entries(elevenLabsConfig.agents).find(
    ([, id]) => id === original.agentId,
  )?.[0] as ElevenLabsAgentType | undefined;

  if (!agentType) return null;

  // Delay before retry
  await delay(elevenLabsConfig.retry.delayMs * original.attemptNumber);

  return initiateCall({
    bookingId: original.bookingId,
    callerId: original.callerId,
    phoneNumber: original.phoneNumber,
    agentType,
    direction: original.direction,
    attemptNumber: original.attemptNumber + 1,
  });
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function buildFirstMessage(
  agentType: ElevenLabsAgentType,
  vars: Record<string, string>,
): string {
  const templates: Record<ElevenLabsAgentType, string> = {
    providerDispatch: `Hello ${vars.providerName ?? 'there'}, this is RoundU. You have a new booking request from ${vars.userName ?? 'a customer'} for ${vars.serviceName ?? 'a service'} on ${vars.scheduledAt ?? 'a scheduled date'}. Press 1 to accept or say reject to decline.`,
    userConfirmation: `Hello ${vars.userName ?? 'there'}, your booking for ${vars.serviceName ?? 'a service'} has been confirmed. Your provider ${vars.providerName ?? ''} is on the way.`,
    bookingReminder: `Hello ${vars.userName ?? 'there'}, this is a reminder from RoundU. Your ${vars.serviceName ?? 'service'} appointment is scheduled for ${vars.scheduledAt ?? 'soon'}. Reply YES to confirm or NO to reschedule.`,
  };

  return templates[agentType] ?? 'Hello, this is RoundU calling.';
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
