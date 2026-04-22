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
import {
  createTestUser,
  createWallet,
  createReferralCode,
  getWalletBalance,
  countWalletTransactions,
} from '../helpers/factories';

describe('Referral flow (integration)', () => {
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
  });

  afterAll(async () => {
    await closeTestPool();
  });

  // ───────── GET /api/referrals/my-code ──────────────────────────────────────

  describe('GET /api/referrals/my-code', () => {
    it('returns 401 without auth', async () => {
      const res = await request(testApp.app).get('/api/referrals/my-code');
      expect(res.status).toBe(401);
    });

    it('lazily creates a referral code on first access', async () => {
      const user = await createTestUser(db, { name: 'Arjun R' });
      const res = await request(testApp.app)
        .get('/api/referrals/my-code')
        .set(bearer(tokenFor(user)));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.code).toMatch(/^ARJUNR[A-F0-9]{4}$/);
      expect(res.body.data.shareUrl).toContain('ref=');
      expect(res.body.data.totalEarned).toBe(0);
      expect(res.body.data.totalReferrals).toBe(0);
    });

    it('is idempotent — repeated calls return the same code', async () => {
      const user = await createTestUser(db);
      const token = tokenFor(user);
      const first = await request(testApp.app)
        .get('/api/referrals/my-code')
        .set(bearer(token));
      const second = await request(testApp.app)
        .get('/api/referrals/my-code')
        .set(bearer(token));

      expect(first.body.data.code).toBe(second.body.data.code);

      const count = await db.query<{ c: number }>(
        'SELECT COUNT(*)::int AS c FROM referral_codes WHERE user_id = $1',
        [user.id],
      );
      expect(count.rows[0].c).toBe(1);
    });

    it('aggregates totalEarned across settled referrals', async () => {
      const referrer = await createTestUser(db, { name: 'Arjun' });
      await createReferralCode(db, referrer.id, 'ARJUN01');

      const a = await createTestUser(db);
      const b = await createTestUser(db);
      await db.query(
        `INSERT INTO referrals (referrer_id, referred_id, code, reward_amount, status, settled_at)
         VALUES ($1, $2, 'ARJUN01', 50, 'settled', NOW()),
                ($1, $3, 'ARJUN01', 50, 'settled', NOW())`,
        [referrer.id, a.id, b.id],
      );

      const res = await request(testApp.app)
        .get('/api/referrals/my-code')
        .set(bearer(tokenFor(referrer)));

      expect(res.status).toBe(200);
      expect(res.body.data.totalEarned).toBe(100);
      expect(res.body.data.totalReferrals).toBe(2);
    });
  });

  // ───────── POST /api/referrals/apply ──────────────────────────────────────

  describe('POST /api/referrals/apply', () => {
    it('rejects missing code with VALIDATION_ERROR', async () => {
      const user = await createTestUser(db);
      const res = await request(testApp.app)
        .post('/api/referrals/apply')
        .set(bearer(tokenFor(user)))
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects a code that does not exist', async () => {
      const user = await createTestUser(db);
      await createWallet(db, user.id);
      const res = await request(testApp.app)
        .post('/api/referrals/apply')
        .set(bearer(tokenFor(user)))
        .send({ code: 'UNKNOWNCODE' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_REFERRAL_CODE');
    });

    it('rejects self-referral', async () => {
      const user = await createTestUser(db);
      await createWallet(db, user.id);
      await createReferralCode(db, user.id, 'MYCODE01');

      const res = await request(testApp.app)
        .post('/api/referrals/apply')
        .set(bearer(tokenFor(user)))
        .send({ code: 'MYCODE01' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('SELF_REFERRAL');
    });

    it('credits both wallets and marks referral settled on success', async () => {
      const referrer = await createTestUser(db);
      const referred = await createTestUser(db);
      await createWallet(db, referrer.id, 0);
      await createWallet(db, referred.id, 0);
      await createReferralCode(db, referrer.id, 'BONUS100');

      const res = await request(testApp.app)
        .post('/api/referrals/apply')
        .set(bearer(tokenFor(referred)))
        .send({ code: 'BONUS100' });

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ rewardAmount: 50, currency: 'INR' });

      expect(await getWalletBalance(db, referrer.id)).toBe(50);
      expect(await getWalletBalance(db, referred.id)).toBe(50);
      expect(await countWalletTransactions(db, referrer.id, 'credit')).toBe(1);
      expect(await countWalletTransactions(db, referred.id, 'credit')).toBe(1);

      const r = await db.query<{ status: string; settled_at: Date | null }>(
        `SELECT status, settled_at FROM referrals WHERE referred_id = $1`,
        [referred.id],
      );
      expect(r.rows[0].status).toBe('settled');
      expect(r.rows[0].settled_at).not.toBeNull();
    });

    it('normalizes code to uppercase during validation', async () => {
      const referrer = await createTestUser(db);
      const referred = await createTestUser(db);
      await createWallet(db, referrer.id);
      await createWallet(db, referred.id);
      await createReferralCode(db, referrer.id, 'UPPERCASE1');

      const res = await request(testApp.app)
        .post('/api/referrals/apply')
        .set(bearer(tokenFor(referred)))
        .send({ code: 'uppercase1' });

      expect(res.status).toBe(200);
    });

    it('rejects duplicate application by the same user', async () => {
      const r1 = await createTestUser(db);
      const r2 = await createTestUser(db);
      const referred = await createTestUser(db);
      await createWallet(db, r1.id);
      await createWallet(db, r2.id);
      await createWallet(db, referred.id);
      await createReferralCode(db, r1.id, 'FIRSTCODE');
      await createReferralCode(db, r2.id, 'SECONDCOD');

      const first = await request(testApp.app)
        .post('/api/referrals/apply')
        .set(bearer(tokenFor(referred)))
        .send({ code: 'FIRSTCODE' });
      expect(first.status).toBe(200);

      const second = await request(testApp.app)
        .post('/api/referrals/apply')
        .set(bearer(tokenFor(referred)))
        .send({ code: 'SECONDCOD' });
      expect(second.status).toBe(409);
      expect(second.body.error.code).toBe('CONFLICT');
    });
  });

  // ───────── GET /api/referrals/history ─────────────────────────────────────

  describe('GET /api/referrals/history', () => {
    it('returns empty list when no referrals', async () => {
      const user = await createTestUser(db);
      const res = await request(testApp.app)
        .get('/api/referrals/history')
        .set(bearer(tokenFor(user)));
      expect(res.status).toBe(200);
      expect(res.body.data.data).toEqual([]);
      expect(res.body.data.total).toBe(0);
      expect(res.body.data.page).toBe(1);
      expect(res.body.data.limit).toBe(20);
    });

    it('paginates referrals by most-recent-first', async () => {
      const referrer = await createTestUser(db);
      await createReferralCode(db, referrer.id, 'PAGINATE1');

      for (let i = 0; i < 5; i++) {
        const r = await createTestUser(db, { name: `Friend ${i}` });
        await db.query(
          `INSERT INTO referrals (referrer_id, referred_id, code, reward_amount, status, created_at)
           VALUES ($1, $2, 'PAGINATE1', 50, 'settled', NOW() + ($3 || ' seconds')::interval)`,
          [referrer.id, r.id, i],
        );
      }

      const page1 = await request(testApp.app)
        .get('/api/referrals/history?page=1&limit=3')
        .set(bearer(tokenFor(referrer)));
      expect(page1.status).toBe(200);
      expect(page1.body.data.data.length).toBe(3);
      expect(page1.body.data.total).toBe(5);

      const page2 = await request(testApp.app)
        .get('/api/referrals/history?page=2&limit=3')
        .set(bearer(tokenFor(referrer)));
      expect(page2.body.data.data.length).toBe(2);

      const ids1 = new Set(page1.body.data.data.map((r: { id: string }) => r.id));
      const ids2 = new Set(page2.body.data.data.map((r: { id: string }) => r.id));
      for (const id of ids2) expect(ids1.has(id as string)).toBe(false);
    });

    it('caps limit at 50', async () => {
      const user = await createTestUser(db);
      const res = await request(testApp.app)
        .get('/api/referrals/history?limit=9999')
        .set(bearer(tokenFor(user)));
      expect(res.status).toBe(200);
      expect(res.body.data.limit).toBe(50);
    });

    it('coerces invalid page numbers to 1', async () => {
      const user = await createTestUser(db);
      const res = await request(testApp.app)
        .get('/api/referrals/history?page=-5')
        .set(bearer(tokenFor(user)));
      expect(res.body.data.page).toBe(1);
    });
  });
});
