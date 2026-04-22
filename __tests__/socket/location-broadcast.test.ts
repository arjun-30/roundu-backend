/**
 * Verifies that tracking.updateLocation emits the right Socket.IO event to the
 * right room. Uses a fake Socket.IO server that records emissions — no real
 * server needed.
 */
import { Pool } from 'pg';
import type { Server as SocketServer } from 'socket.io';
import { startSession, updateLocation } from '../../src/services/tracking.service';
import {
  getTestPool,
  closeTestPool,
  initTestSchema,
  resetTestData,
  waitForDb,
} from '../helpers/db';
import { createTestUser, createBooking } from '../helpers/factories';

interface EmittedEvent {
  room: string;
  event: string;
  payload: unknown;
}

function makeRecordingIo(sink: EmittedEvent[]): SocketServer {
  return {
    to(room: string) {
      return {
        emit(event: string, payload: unknown) {
          sink.push({ room, event, payload });
        },
      };
    },
  } as unknown as SocketServer;
}

describe('tracking — location broadcast', () => {
  let db: Pool;

  beforeAll(async () => {
    db = getTestPool();
    await waitForDb();
    await initTestSchema();
  });

  beforeEach(async () => {
    await resetTestData();
  });

  afterAll(async () => {
    await closeTestPool();
  });

  it('emits provider:location_updated exactly once per update, to booking:<id> room', async () => {
    const user = await createTestUser(db, { role: 'user' });
    const provider = await createTestUser(db, { role: 'provider' });
    const bookingId = await createBooking(db, {
      userId: user.id,
      providerId: provider.id,
      status: 'confirmed',
    });

    const { sessionId } = await startSession(db, provider.id, bookingId);

    const events: EmittedEvent[] = [];
    const io = makeRecordingIo(events);

    await updateLocation(db, io, provider.id, sessionId, 12.97, 77.59);

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      room: `booking:${bookingId}`,
      event: 'provider:location_updated',
      payload: { bookingId, lat: 12.97, lng: 77.59 },
    });
  });

  it('emits one event per call across multiple updates', async () => {
    const user = await createTestUser(db);
    const provider = await createTestUser(db, { role: 'provider' });
    const bookingId = await createBooking(db, {
      userId: user.id,
      providerId: provider.id,
      status: 'in_progress',
    });
    const { sessionId } = await startSession(db, provider.id, bookingId);

    const events: EmittedEvent[] = [];
    const io = makeRecordingIo(events);

    await updateLocation(db, io, provider.id, sessionId, 12.9, 77.5);
    await updateLocation(db, io, provider.id, sessionId, 12.91, 77.51);
    await updateLocation(db, io, provider.id, sessionId, 12.92, 77.52);

    expect(events).toHaveLength(3);
    for (const e of events) {
      expect(e.room).toBe(`booking:${bookingId}`);
      expect(e.event).toBe('provider:location_updated');
    }
    expect((events[2].payload as { lat: number }).lat).toBeCloseTo(12.92, 4);
  });

  it('does not emit when the session is owned by a different provider', async () => {
    const user = await createTestUser(db);
    const owner = await createTestUser(db, { role: 'provider' });
    const other = await createTestUser(db, { role: 'provider' });
    const bookingId = await createBooking(db, {
      userId: user.id,
      providerId: owner.id,
    });
    const { sessionId } = await startSession(db, owner.id, bookingId);

    const events: EmittedEvent[] = [];
    const io = makeRecordingIo(events);

    await expect(
      updateLocation(db, io, other.id, sessionId, 0, 0),
    ).rejects.toMatchObject({ statusCode: 403 });

    expect(events).toHaveLength(0);
  });
});
