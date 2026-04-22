// EXISTING — expire pending bookings after 10 min
// Job: booking-expiry.job.ts
// Queue: BullMQ (Redis 7, as per README tech stack)
//
// This job runs on a repeatable schedule (every 60 seconds).
// It finds all pending bookings whose expires_at < NOW() and cancels them.
// A socket event + push notification is emitted for each expired booking.

import { Worker, Queue, Job } from 'bullmq';
import { Pool } from 'pg';
import { Server as SocketServer } from 'socket.io';
import { expirePendingBookings } from '../models/booking.model';

// ---------------------------------------------------------------------------
// Queue definition
// ---------------------------------------------------------------------------

export const BOOKING_EXPIRY_QUEUE = 'booking-expiry';

/** Create a BullMQ queue instance for booking expiry */
export function createBookingExpiryQueue(redisConnection: {
  host: string;
  port: number;
}): Queue {
  return new Queue(BOOKING_EXPIRY_QUEUE, {
    connection: redisConnection,
    defaultJobOptions: {
      removeOnComplete: 10,  // keep last 10 completed jobs for debugging
      removeOnFail: 50,      // keep last 50 failed jobs
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
    },
  });
}

/**
 * Register the repeatable job on app startup.
 * Call this once in server.ts after queue is created.
 */
export async function scheduleBookingExpiryJob(queue: Queue): Promise<void> {
  // Remove any stale version of the repeatable job first
  await queue.removeRepeatable(BOOKING_EXPIRY_QUEUE, {
    every: 60_000, // every 60 seconds
  });

  await queue.add(
    BOOKING_EXPIRY_QUEUE,
    {},  // no payload needed — job scans the DB itself
    {
      repeat: { every: 60_000 },
      jobId: 'booking-expiry-repeatable',
    },
  );
}

// ---------------------------------------------------------------------------
// Worker
// ---------------------------------------------------------------------------

/**
 * Start the booking expiry worker.
 * @param db              - PostgreSQL pool
 * @param io              - Socket.io server (for emitting events to affected users)
 * @param redisConnection - Redis connection config
 */
export function startBookingExpiryWorker(
  db: Pool,
  io: SocketServer,
  redisConnection: { host: string; port: number },
): Worker {
  const worker = new Worker(
    BOOKING_EXPIRY_QUEUE,
    async (job: Job) => {
      await processBookingExpiry(db, io, job);
    },
    {
      connection: redisConnection,
      concurrency: 1,  // single-threaded — avoids race conditions on the DB update
    },
  );

  worker.on('completed', (job) => {
    console.info(`[booking-expiry] Job ${job.id} completed`);
  });

  worker.on('failed', (job, err) => {
    console.error(`[booking-expiry] Job ${job?.id} failed:`, err);
  });

  return worker;
}

// ---------------------------------------------------------------------------
// Core logic
// ---------------------------------------------------------------------------

async function processBookingExpiry(
  db: Pool,
  io: SocketServer,
  job: Job,
): Promise<void> {
  // 1. Find and expire all past-due pending bookings
  const expiredCount = await expirePendingBookings(db);

  if (expiredCount === 0) {
    await job.log('No expired bookings found');
    return;
  }

  await job.log(`Expired ${expiredCount} booking(s)`);

  // 2. Fetch the IDs that were just expired so we can notify users
  //    (expirePendingBookings already set status=cancelled, so we query cancelled ones
  //     with cancelled_by='system' that were updated in the last 2 minutes)
  const recentlyExpired = await db.query<{ id: string; user_id: string }>(
    `SELECT id, user_id
     FROM bookings
     WHERE status = 'cancelled'
       AND cancelled_by = 'system'
       AND updated_at > NOW() - INTERVAL '2 minutes'`,
  );

  for (const row of recentlyExpired.rows) {
    // 3. Emit socket event to the user's room
    io.to(`user:${row.user_id}`).emit('booking:status_changed', {
      bookingId: row.id,
      status: 'cancelled',
      reason: 'No provider accepted your booking in time. Please try again.',
    });

    // 4. Create an in-app notification row
    await db.query(
      `INSERT INTO notifications (user_id, title, body, type)
       VALUES ($1, $2, $3, 'booking_expired')
       ON CONFLICT DO NOTHING`,
      [
        row.user_id,
        'Booking Expired',
        'No provider was available for your booking. Please try booking again.',
      ],
    );
  }

  await job.updateProgress(100);
}
