// EXISTING — sendPush, sendToMultiple
// Owner: Dev 2 — Subscriptions + Notifications
import { getMessaging } from 'firebase-admin/messaging';
import { logger } from '../utils/logger';

export interface FcmPayload {
  title: string;
  body: string;
  data?: Record<string, string>;
  imageUrl?: string;
}

/**
 * Send a push notification to a single device token.
 * Silently swallows invalid-token errors (device uninstalled, etc.)
 * so callers don't need to handle FCM-specific error shapes.
 */
export async function sendToDevice(token: string, payload: FcmPayload): Promise<void> {
  try {
    await getMessaging().send({
      token,
      notification: {
        title: payload.title,
        body: payload.body,
        imageUrl: payload.imageUrl,
      },
      data: payload.data ?? {},
      android: { priority: 'high' },
      apns:    { payload: { aps: { sound: 'default' } } },
    });
  } catch (err: unknown) {
    // Don't crash callers for stale tokens
    logger.warn({ token, err }, 'FCM send failed');
  }
}

/**
 * Multicast to up to 500 tokens in one FCM request.
 */
export async function sendToMultipleDevices(
  tokens: string[],
  payload: FcmPayload
): Promise<void> {
  if (tokens.length === 0) return;
  const chunks = chunkArray(tokens, 500);
  await Promise.all(
    chunks.map((chunk) =>
      getMessaging().sendEachForMulticast({
        tokens: chunk,
        notification: { title: payload.title, body: payload.body },
        data: payload.data ?? {},
        android: { priority: 'high' },
        apns:    { payload: { aps: { sound: 'default' } } },
      })
    )
  );
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) result.push(arr.slice(i, i + size));
  return result;
}
