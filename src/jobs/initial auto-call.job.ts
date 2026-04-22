// DEV 2 — every minute: find bookings 30min out, trigger ElevenLabs AI voice call
// Owner: Dev 4 — Real-time & Communications
// Purpose: BullMQ job — triggers ElevenLabs outbound call to provider/user for a booking

import { Job } from 'bullmq';
import { getQueue, registerWorker } from './queue';
import { initiateCall, retryCall } from '../services/elevenlabs.service';
import { emitIncomingCall } from '../socket/emitters';
import { ElevenLabsAgentType } from '../config/elevenlabs';
import { logger } from '../utils/logger';

// ─── Queue & Job types ────────────────────────────────────────────────────

export const AUTO_CALL_QUEUE = 'auto-call';

export interface AutoCallJobData {
  bookingId: string;
  targetUserId: string;   // User or provider UUID who will receive the call
  phoneNumber: string;    // E.164 phone number
  agentType: ElevenLabsAgentType;
  direction: 'outbound_provider' | 'outbound_user';
  dynamicVariables?: Record<string, string>;
  attemptNumber?: number;
}

// ─── Enqueue helper ───────────────────────────────────────────────────────

/**
 * Add an auto-call job to the queue.
 * @param data        Job payload
 * @param delayMs     Optional delay before processing (default: 0)
 */
export async function scheduleAutoCall(
  data: AutoCallJobData,
  delayMs = 0,
): Promise<void> {
  const queue = getQueue(AUTO_CALL_QUEUE);

  await queue.add('auto-call', data, {
    delay: delayMs,
    attempts: 3,
    backoff: { type: 'fixed', delay: 5_000 },
    removeOnComplete: { count: 200 },
    removeOnFail: { count: 100 },
  });

  logger.info(
    `[AutoCallJob] Queued — booking=${data.bookingId} agent=${data.agentType} delay=${delayMs}ms`,
  );
}

// ─── Worker ───────────────────────────────────────────────────────────────

export function startAutoCallWorker(): void {
  registerWorker(AUTO_CALL_QUEUE, async (job: Job<AutoCallJobData>) => {
    const data = job.data;
    logger.info(`[AutoCallJob] Processing — booking=${data.bookingId} attempt=${data.attemptNumber ?? 1}`);

    // 1. Emit socket event so the app can show "Incoming call" UI before the phone rings
    emitIncomingCall(data.targetUserId, data.bookingId, 'roundu-system');

    // 2. Small buffer to allow UI to react (500ms)
    await new Promise((r) => setTimeout(r, 500));

    // 3. Initiate the ElevenLabs call
    const result = await initiateCall({
      bookingId: data.bookingId,
      callerId: data.targetUserId,
      phoneNumber: data.phoneNumber,
      agentType: data.agentType,
      direction: data.direction,
      attemptNumber: data.attemptNumber ?? 1,
      dynamicVariables: data.dynamicVariables,
    });

    if (!result.success) {
      // BullMQ will retry automatically per job options
      throw new Error(`Call failed: ${result.error ?? 'unknown'}`);
    }

    logger.info(
      `[AutoCallJob] Call succeeded — booking=${data.bookingId} conv=${result.conversationId}`,
    );
  });

  logger.info('[AutoCallJob] Worker started');
}

// ─── Convenience schedulers ───────────────────────────────────────────────

/**
 * Call a provider immediately to notify them of a new booking.
 */
export async function callProviderForBooking(opts: {
  bookingId: string;
  providerId: string;
  providerPhone: string;
  providerName: string;
  userName: string;
  serviceName: string;
  scheduledAt: string;
}): Promise<void> {
  await scheduleAutoCall({
    bookingId: opts.bookingId,
    targetUserId: opts.providerId,
    phoneNumber: opts.providerPhone,
    agentType: 'providerDispatch',
    direction: 'outbound_provider',
    dynamicVariables: {
      providerName: opts.providerName,
      userName: opts.userName,
      serviceName: opts.serviceName,
      scheduledAt: opts.scheduledAt,
    },
  });
}

/**
 * Call a user to confirm their booking with a 2-minute delay.
 */
export async function callUserForConfirmation(opts: {
  bookingId: string;
  userId: string;
  userPhone: string;
  userName: string;
  providerName: string;
  serviceName: string;
}): Promise<void> {
  await scheduleAutoCall(
    {
      bookingId: opts.bookingId,
      targetUserId: opts.userId,
      phoneNumber: opts.userPhone,
      agentType: 'userConfirmation',
      direction: 'outbound_user',
      dynamicVariables: {
        userName: opts.userName,
        providerName: opts.providerName,
        serviceName: opts.serviceName,
      },
    },
    2 * 60 * 1000, // 2-min delay
  );
}
