import express from 'express';
import request from 'supertest';
import {
  authenticate,
  requireRole,
  requireProvider,
  requireAdmin,
} from '../../src/middleware/auth';
import { errorHandler } from '../../src/middleware/errorHandler';
import { signAccessToken } from '../../src/utils/jwt';

function makeApp(mountExtra?: (app: express.Express) => void) {
  const app = express();
  app.use(express.json());
  app.get('/protected', authenticate, (req, res) => {
    res.json({ user: req.user });
  });
  mountExtra?.(app);
  app.use(errorHandler);
  return app;
}

describe('authenticate', () => {
  it('401s when no Authorization header', async () => {
    const res = await request(makeApp()).get('/protected');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('401s when header does not start with Bearer', async () => {
    const res = await request(makeApp())
      .get('/protected')
      .set('Authorization', 'Basic abc');
    expect(res.status).toBe(401);
  });

  it('401s on invalid token', async () => {
    const res = await request(makeApp())
      .get('/protected')
      .set('Authorization', 'Bearer garbage');
    expect(res.status).toBe(401);
    expect(res.body.error.message).toMatch(/Invalid/i);
  });

  it('401s on expired token', async () => {
    const jwt = require('jsonwebtoken');
    const expired = jwt.sign(
      { sub: 'u1', role: 'user', phone: '+910' },
      process.env.JWT_ACCESS_SECRET!,
      { issuer: 'roundu', audience: 'roundu-client', expiresIn: -10 },
    );
    const res = await request(makeApp())
      .get('/protected')
      .set('Authorization', `Bearer ${expired}`);
    expect(res.status).toBe(401);
    expect(res.body.error.message).toMatch(/expired/i);
  });

  it('attaches req.user with both sub and id on valid token', async () => {
    const token = signAccessToken({ sub: 'u-42', role: 'provider', phone: '+910' });
    const res = await request(makeApp())
      .get('/protected')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.user.sub).toBe('u-42');
    expect(res.body.user.id).toBe('u-42');
    expect(res.body.user.role).toBe('provider');
  });
});

describe('requireRole / requireProvider / requireAdmin', () => {
  function roleApp(guard: express.RequestHandler) {
    return makeApp((app) => {
      app.get('/guarded', authenticate, guard, (_req, res) => {
        res.json({ ok: true });
      });
    });
  }

  it('requireProvider: 403 for user role', async () => {
    const token = signAccessToken({ sub: 'u', role: 'user', phone: '+910' });
    const res = await request(roleApp(requireProvider))
      .get('/guarded')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('requireProvider: passes through provider', async () => {
    const token = signAccessToken({ sub: 'u', role: 'provider', phone: '+910' });
    const res = await request(roleApp(requireProvider))
      .get('/guarded')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
  });

  it('requireAdmin: 403 for provider role', async () => {
    const token = signAccessToken({ sub: 'u', role: 'provider', phone: '+910' });
    const res = await request(roleApp(requireAdmin))
      .get('/guarded')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it('requireRole accepts any listed role', async () => {
    const guard = requireRole('user', 'admin');
    const userToken = signAccessToken({ sub: 'u', role: 'user', phone: '+910' });
    const adminToken = signAccessToken({ sub: 'a', role: 'admin', phone: '+910' });
    const providerToken = signAccessToken({ sub: 'p', role: 'provider', phone: '+910' });

    expect(
      (await request(roleApp(guard)).get('/guarded').set('Authorization', `Bearer ${userToken}`)).status,
    ).toBe(200);
    expect(
      (await request(roleApp(guard)).get('/guarded').set('Authorization', `Bearer ${adminToken}`)).status,
    ).toBe(200);
    expect(
      (await request(roleApp(guard)).get('/guarded').set('Authorization', `Bearer ${providerToken}`)).status,
    ).toBe(403);
  });
});
