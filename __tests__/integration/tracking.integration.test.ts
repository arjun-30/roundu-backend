import request from 'supertest';
import { Pool } from 'pg';
import { buildTestApp, TestApp } from '../helpers/app';
import { tokenFor, bearer } from '../helpers/auth';
import {
  getTestPool,
  closeTestPool,
  initTestSchema,
  resetTestData,
  waitForDb,
} from '../helpers/db';
import { createTestUser, createBooking } from '../helpers/factories';

describe('Tracking flow (integration)', () => {
  let db: Pool;
  let testApp: TestApp;

  beforeAll(async () => {
    db = getTestPool();
    await waitForDb();
    await initTestSchema();
    testApp = buildTestApp(db);
  });

  beforeEach(async () => {
    await resetTestData();
    testApp.emittedEvents.length = 0;
  });

  afterAll(async () => {
    await closeTestPool();
  });

  async function setupBooking(status = 'confirmed') {
    const user = await createTestUser(db, { role: 'user' });
    const provider = await createTestUser(db, { role: 'provider' });
    const bookingId = await createBooking(db, {
      userId: user.id,
      providerId: provider.id,
      status,
    });
    return {
      providerId: provider.id,
      providerToken: tokenFor({ id: provider.id, role: 'provider' }),
      userId: user.id,
      userToken: tokenFor({ id: user.id, role: 'user' }),
      bookingId,
    };
  }

  // ───────── POST /api/tracking/start ───────────────────────────────────────

  describe('POST /api/tracking/start', () => {
    it('requires authentication', async () => {
      const res = await request(testApp.app).post('/api/tracking/start').send({});
      expect(res.status).toBe(401);
    });

    it('requires provider role', async () => {
      const user = await createTestUser(db, { role: 'user' });
      const res = await request(testApp.app)
        .post('/api/tracking/start')
        .set(bearer(tokenFor({ id: user.id, role: 'user' })))
        .send({ bookingId: '11111111-1111-4111-8111-111111111111' });
      expect(res.status).toBe(403);
    });

    it('400 for non-UUID bookingId', async () => {
      const provider = await createTestUser(db, { role: 'provider' });
      const res = await request(testApp.app)
        .post('/api/tracking/start')
        .set(bearer(tokenFor({ id: provider.id, role: 'provider' })))
        .send({ bookingId: 'not-a-uuid' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('404 when booking does not exist', async () => {
      const provider = await createTestUser(db, { role: 'provider' });
      const res = await request(testApp.app)
        .post('/api/tracking/start')
        .set(bearer(tokenFor({ id: provider.id, role: 'provider' })))
        .send({ bookingId: '99999999-9999-4999-8999-999999999999' });
      expect(res.status).toBe(404);
    });

    it('403 when booking belongs to another provider', async () => {
      const other = await createTestUser(db, { role: 'provider' });
      const user = await createTestUser(db);
      const bookingId = await createBooking(db, { userId: user.id, providerId: other.id });

      const me = await createTestUser(db, { role: 'provider' });
      const res = await request(testApp.app)
        .post('/api/tracking/start')
        .set(bearer(tokenFor({ id: me.id, role: 'provider' })))
        .send({ bookingId });
      expect(res.status).toBe(403);
    });

    it('422 when booking status is not confirmed / in_progress', async () => {
      const s = await setupBooking('pending');
      const res = await request(testApp.app)
        .post('/api/tracking/start')
        .set(bearer(s.providerToken))
        .send({ bookingId: s.bookingId });
      expect(res.status).toBe(422);
    });

    it('creates a tracking session for a confirmed booking', async () => {
      const s = await setupBooking('confirmed');
      const res = await request(testApp.app)
        .post('/api/tracking/start')
        .set(bearer(s.providerToken))
        .send({ bookingId: s.bookingId });

      expect(res.status).toBe(201);
      expect(res.body.data.sessionId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );

      const row = await db.query('SELECT status FROM tracking_sessions WHERE booking_id = $1', [
        s.bookingId,
      ]);
      expect(row.rows[0].status).toBe('active');
    });

    it('409 when a second active session is started for the same booking', async () => {
      const s = await setupBooking('confirmed');
      await request(testApp.app)
        .post('/api/tracking/start')
        .set(bearer(s.providerToken))
        .send({ bookingId: s.bookingId });

      const second = await request(testApp.app)
        .post('/api/tracking/start')
        .set(bearer(s.providerToken))
        .send({ bookingId: s.bookingId });
      expect(second.status).toBe(409);
    });
  });

  // ───────── PATCH /api/tracking/:sessionId/location ────────────────────────

  describe('PATCH /api/tracking/:sessionId/location', () => {
    async function startSession() {
      const s = await setupBooking('in_progress');
      const start = await request(testApp.app)
        .post('/api/tracking/start')
        .set(bearer(s.providerToken))
        .send({ bookingId: s.bookingId });
      return { ...s, sessionId: start.body.data.sessionId as string };
    }

    it('persists location + updates last known location', async () => {
      const s = await startSession();
      const res = await request(testApp.app)
        .patch(`/api/tracking/${s.sessionId}/location`)
        .set(bearer(s.providerToken))
        .send({ lat: 12.97, lng: 77.59, accuracy: 5 });

      expect(res.status).toBe(200);

      const row = await db.query(
        'SELECT last_lat, last_lng FROM tracking_sessions WHERE id = $1',
        [s.sessionId],
      );
      expect(Number(row.rows[0].last_lat)).toBeCloseTo(12.97, 4);
      expect(Number(row.rows[0].last_lng)).toBeCloseTo(77.59, 4);

      const count = await db.query<{ c: number }>(
        'SELECT COUNT(*)::int AS c FROM tracking_locations WHERE session_id = $1',
        [s.sessionId],
      );
      expect(count.rows[0].c).toBe(1);
    });

    it('emits provider:location_updated to booking room with correct payload', async () => {
      const s = await startSession();
      testApp.emittedEvents.length = 0;

      await request(testApp.app)
        .patch(`/api/tracking/${s.sessionId}/location`)
        .set(bearer(s.providerToken))
        .send({ lat: 12.97, lng: 77.59 });

      expect(testApp.emittedEvents).toHaveLength(1);
      expect(testApp.emittedEvents[0]).toEqual({
        room: `booking:${s.bookingId}`,
        event: 'provider:location_updated',
        payload: { bookingId: s.bookingId, lat: 12.97, lng: 77.59 },
      });
    });

    it('400 for lat out of range', async () => {
      const s = await startSession();
      const res = await request(testApp.app)
        .patch(`/api/tracking/${s.sessionId}/location`)
        .set(bearer(s.providerToken))
        .send({ lat: 91, lng: 0 });
      expect(res.status).toBe(400);
    });

    it('403 when session belongs to a different provider', async () => {
      const s = await startSession();
      const other = await createTestUser(db, { role: 'provider' });

      const res = await request(testApp.app)
        .patch(`/api/tracking/${s.sessionId}/location`)
        .set(bearer(tokenFor({ id: other.id, role: 'provider' })))
        .send({ lat: 0, lng: 0 });

      expect(res.status).toBe(403);
    });

    it('404 for a non-existent session id', async () => {
      const provider = await createTestUser(db, { role: 'provider' });
      const res = await request(testApp.app)
        .patch('/api/tracking/99999999-9999-4999-8999-999999999999/location')
        .set(bearer(tokenFor({ id: provider.id, role: 'provider' })))
        .send({ lat: 0, lng: 0 });
      expect(res.status).toBe(404);
    });
  });

  // ───────── GET /api/tracking/:sessionId ───────────────────────────────────

  describe('GET /api/tracking/:sessionId', () => {
    it('returns session details in camelCase', async () => {
      const s = await setupBooking('confirmed');
      const start = await request(testApp.app)
        .post('/api/tracking/start')
        .set(bearer(s.providerToken))
        .send({ bookingId: s.bookingId });
      const sessionId = start.body.data.sessionId;

      const res = await request(testApp.app)
        .get(`/api/tracking/${sessionId}`)
        .set(bearer(s.userToken));

      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({
        id: sessionId,
        bookingId: s.bookingId,
        providerId: s.providerId,
        status: 'active',
      });
    });

    it('404 for unknown session', async () => {
      const user = await createTestUser(db);
      const res = await request(testApp.app)
        .get('/api/tracking/99999999-9999-4999-8999-999999999999')
        .set(bearer(tokenFor(user)));
      expect(res.status).toBe(404);
    });
  });

  // ───────── POST /api/tracking/:sessionId/end ──────────────────────────────

  describe('POST /api/tracking/:sessionId/end', () => {
    it('ends an active session and returns summary', async () => {
      const s = await setupBooking('confirmed');
      const start = await request(testApp.app)
        .post('/api/tracking/start')
        .set(bearer(s.providerToken))
        .send({ bookingId: s.bookingId });
      const sessionId = start.body.data.sessionId;

      for (const [lat, lng] of [
        [12.9, 77.5],
        [12.91, 77.51],
      ]) {
        await request(testApp.app)
          .patch(`/api/tracking/${sessionId}/location`)
          .set(bearer(s.providerToken))
          .send({ lat, lng });
      }

      const res = await request(testApp.app)
        .post(`/api/tracking/${sessionId}/end`)
        .set(bearer(s.providerToken));

      expect(res.status).toBe(200);
      expect(res.body.data.sessionId).toBe(sessionId);
      expect(res.body.data.totalPoints).toBe(2);
      expect(res.body.data.durationMinutes).toBeGreaterThanOrEqual(0);

      const row = await db.query<{ status: string }>(
        'SELECT status FROM tracking_sessions WHERE id = $1',
        [sessionId],
      );
      expect(row.rows[0].status).toBe('ended');
    });

    it('403 when ended by a different provider', async () => {
      const s = await setupBooking('confirmed');
      const start = await request(testApp.app)
        .post('/api/tracking/start')
        .set(bearer(s.providerToken))
        .send({ bookingId: s.bookingId });
      const sessionId = start.body.data.sessionId;

      const other = await createTestUser(db, { role: 'provider' });
      const res = await request(testApp.app)
        .post(`/api/tracking/${sessionId}/end`)
        .set(bearer(tokenFor({ id: other.id, role: 'provider' })));
      expect(res.status).toBe(403);
    });

    it('400 on ending an already-ended session', async () => {
      const s = await setupBooking('confirmed');
      const start = await request(testApp.app)
        .post('/api/tracking/start')
        .set(bearer(s.providerToken))
        .send({ bookingId: s.bookingId });
      const sessionId = start.body.data.sessionId;

      await request(testApp.app)
        .post(`/api/tracking/${sessionId}/end`)
        .set(bearer(s.providerToken));

      const again = await request(testApp.app)
        .post(`/api/tracking/${sessionId}/end`)
        .set(bearer(s.providerToken));
      expect(again.status).toBe(400);
    });

    it('400 on location update after session ended', async () => {
      const s = await setupBooking('confirmed');
      const start = await request(testApp.app)
        .post('/api/tracking/start')
        .set(bearer(s.providerToken))
        .send({ bookingId: s.bookingId });
      const sessionId = start.body.data.sessionId;

      await request(testApp.app)
        .post(`/api/tracking/${sessionId}/end`)
        .set(bearer(s.providerToken));

      const res = await request(testApp.app)
        .patch(`/api/tracking/${sessionId}/location`)
        .set(bearer(s.providerToken))
        .send({ lat: 0, lng: 0 });
      expect(res.status).toBe(400);
    });
  });
});
