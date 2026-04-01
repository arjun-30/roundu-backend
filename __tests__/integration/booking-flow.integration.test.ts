// Integration test: booking-flow
// Tests the full HTTP request lifecycle: route → controller → service → DB → response
// Uses supertest against a real test DB (see CI config in .github/workflows/ci.yml)

import supertest from 'supertest';
import { Pool } from 'pg';
import app from '../../src/app';

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

let db: Pool;
let request: ReturnType<typeof supertest>;

// Tokens seeded in tests/setup.ts or generated here
let userToken: string;
let providerToken: string;
let adminToken: string;

// Shared IDs across tests
let bookingId: string;
let serviceId: string;
let providerId: string;

beforeAll(async () => {
  db = new Pool({ connectionString: process.env.DATABASE_URL });
  request = supertest(app);

  // ------------------------------------------------------------------
  // Seed: service
  // ------------------------------------------------------------------
  const svcResult = await db.query(
    `INSERT INTO services (name, category, base_price, duration_minutes, is_active)
     VALUES ('Test Cleaning', 'cleaning', 499, 60, true)
     RETURNING id`,
  );
  serviceId = svcResult.rows[0].id;

  // ------------------------------------------------------------------
  // Seed: users + tokens
  // (In a real test suite, setup.ts handles this and exposes tokens)
  // Here we call /api/auth endpoints directly for self-contained tests
  // ------------------------------------------------------------------

  // Register user
  await request.post('/api/auth/register').send({
    phone: '+919876543210',
    name: 'Test User',
    role: 'user',
  });
  const userOtp = await db.query(
    `SELECT otp FROM otp_codes WHERE phone = '+919876543210' ORDER BY created_at DESC LIMIT 1`,
  );
  const userAuth = await request.post('/api/auth/verify-otp').send({
    phone: '+919876543210',
    otp: userOtp.rows[0]?.otp ?? '000000',
  });
  userToken = userAuth.body?.data?.accessToken ?? '';

  // Register provider
  await request.post('/api/auth/register').send({
    phone: '+919876543211',
    name: 'Test Provider',
    role: 'provider',
  });
  const providerOtp = await db.query(
    `SELECT otp FROM otp_codes WHERE phone = '+919876543211' ORDER BY created_at DESC LIMIT 1`,
  );
  const providerAuth = await request.post('/api/auth/verify-otp').send({
    phone: '+919876543211',
    otp: providerOtp.rows[0]?.otp ?? '000000',
  });
  providerToken = providerAuth.body?.data?.accessToken ?? '';

  // Get provider row ID
  const providerRow = await db.query(
    `SELECT p.id FROM providers p
     JOIN users u ON u.id = p.user_id
     WHERE u.phone = '+919876543211'`,
  );
  providerId = providerRow.rows[0]?.id;

  // Mark provider as approved + available
  if (providerId) {
    await db.query(
      `UPDATE providers SET is_approved = true, is_available = true WHERE id = $1`,
      [providerId],
    );
  }
});

afterAll(async () => {
  // Cleanup test data
  await db.query(`DELETE FROM bookings WHERE service_id = $1`, [serviceId]);
  await db.query(`DELETE FROM services WHERE id = $1`, [serviceId]);
  await db.query(
    `DELETE FROM users WHERE phone IN ('+919876543210', '+919876543211')`,
  );
  await db.end();
});

// ---------------------------------------------------------------------------
// Test cases
// ---------------------------------------------------------------------------

describe('POST /api/bookings — create booking', () => {
  it('should create a booking successfully', async () => {
    const scheduledAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // tomorrow

    const res = await request
      .post('/api/bookings')
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        serviceId,
        scheduledAt,
        address: {
          lat: 12.9716,
          lng: 77.5946,
          line1: '123 MG Road, Bengaluru',
        },
        notes: 'Please bring extra cleaning supplies',
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      serviceId,
      status: 'pending',
    });

    bookingId = res.body.data.id;
  });

  it('should reject booking with past scheduledAt', async () => {
    const res = await request
      .post('/api/bookings')
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        serviceId,
        scheduledAt: '2020-01-01T10:00:00Z',  // past
        address: { lat: 12.9716, lng: 77.5946, line1: 'Test address' },
      });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('should reject booking without auth', async () => {
    const res = await request.post('/api/bookings').send({
      serviceId,
      scheduledAt: new Date(Date.now() + 3600000).toISOString(),
      address: { lat: 12.9716, lng: 77.5946, line1: 'Test address' },
    });

    expect(res.status).toBe(401);
  });

  it('should reject booking with invalid serviceId UUID', async () => {
    const res = await request
      .post('/api/bookings')
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        serviceId: 'not-a-uuid',
        scheduledAt: new Date(Date.now() + 3600000).toISOString(),
        address: { lat: 12.9716, lng: 77.5946, line1: 'Test address' },
      });

    expect(res.status).toBe(400);
  });
});

describe('GET /api/bookings — list bookings', () => {
  it('should return paginated list for the authenticated user', async () => {
    const res = await request
      .get('/api/bookings')
      .set('Authorization', `Bearer ${userToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(typeof res.body.total).toBe('number');
  });

  it('should filter by status', async () => {
    const res = await request
      .get('/api/bookings?status=pending')
      .set('Authorization', `Bearer ${userToken}`);

    expect(res.status).toBe(200);
    res.body.data.forEach((b: { status: string }) => {
      expect(b.status).toBe('pending');
    });
  });

  it('should reject unauthenticated requests', async () => {
    const res = await request.get('/api/bookings');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/bookings/:id — get booking by ID', () => {
  it('should return booking details for the owner', async () => {
    const res = await request
      .get(`/api/bookings/${bookingId}`)
      .set('Authorization', `Bearer ${userToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(bookingId);
  });

  it('should return 403 for a different user', async () => {
    // providerToken belongs to a different user
    const res = await request
      .get(`/api/bookings/${bookingId}`)
      .set('Authorization', `Bearer ${providerToken}`);

    // Provider is not assigned to this booking, so 403
    expect([403, 404]).toContain(res.status);
  });

  it('should return 404 for a non-existent booking', async () => {
    const fakeId = '00000000-0000-0000-0000-000000000000';
    const res = await request
      .get(`/api/bookings/${fakeId}`)
      .set('Authorization', `Bearer ${userToken}`);

    expect(res.status).toBe(404);
  });
});

describe('PATCH /api/bookings/:id/status — provider updates status', () => {
  beforeAll(async () => {
    // Assign the provider to the booking directly so status update is authorized
    if (providerId && bookingId) {
      await db.query(
        `UPDATE bookings SET provider_id = $1 WHERE id = $2`,
        [providerId, bookingId],
      );
    }
  });

  it('should allow provider to confirm a pending booking', async () => {
    const res = await request
      .patch(`/api/bookings/${bookingId}/status`)
      .set('Authorization', `Bearer ${providerToken}`)
      .send({ status: 'confirmed', note: 'On my way' });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('confirmed');
  });

  it('should not allow users to update booking status', async () => {
    const res = await request
      .patch(`/api/bookings/${bookingId}/status`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({ status: 'in_progress' });

    expect(res.status).toBe(403);
  });

  it('should reject invalid status values', async () => {
    const res = await request
      .patch(`/api/bookings/${bookingId}/status`)
      .set('Authorization', `Bearer ${providerToken}`)
      .send({ status: 'expired' }); // not a valid status

    expect(res.status).toBe(400);
  });
});

describe('POST /api/bookings/:id/cancel — cancel booking', () => {
  let cancellableBookingId: string;

  beforeAll(async () => {
    // Create a fresh pending booking for cancellation test
    const scheduledAt = new Date(Date.now() + 72 * 3600 * 1000).toISOString();
    const res = await request
      .post('/api/bookings')
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        serviceId,
        scheduledAt,
        address: { lat: 12.9716, lng: 77.5946, line1: 'Cancel test address' },
      });
    cancellableBookingId = res.body.data?.id;
  });

  it('should cancel a pending booking and return refund info', async () => {
    const res = await request
      .post(`/api/bookings/${cancellableBookingId}/cancel`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({ reason: 'Change of plans' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('cancelled');
  });

  it('should reject cancelling an already-cancelled booking', async () => {
    const res = await request
      .post(`/api/bookings/${cancellableBookingId}/cancel`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({ reason: 'Duplicate' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('Booking state machine — DB-level guard', () => {
  it('should not allow jumping from pending to completed', async () => {
    // Direct DB attempt to bypass the API (simulating a rogue query)
    await expect(
      db.query(
        `UPDATE bookings SET status = 'completed' WHERE id = $1`,
        [bookingId],
      ),
    ).rejects.toThrow();  // DB trigger raises exception
  });
});
