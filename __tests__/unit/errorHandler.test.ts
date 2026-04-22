import express, { Request, Response, NextFunction } from 'express';
import request from 'supertest';
import { z } from 'zod';
import { AppError, Errors, errorHandler, notFoundHandler } from '../../src/middleware/errorHandler';

function makeApp(throwable: unknown) {
  const app = express();
  app.get('/boom', (_req: Request, _res: Response, next: NextFunction) => {
    next(throwable);
  });
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

describe('Errors factory', () => {
  it('produces AppError with the right status + code', () => {
    expect(Errors.badRequest('x').statusCode).toBe(400);
    expect(Errors.unauthorized().statusCode).toBe(401);
    expect(Errors.forbidden().statusCode).toBe(403);
    expect(Errors.notFound('User').statusCode).toBe(404);
    expect(Errors.conflict('dup').statusCode).toBe(409);
    expect(Errors.unprocessable('bad').statusCode).toBe(422);
    expect(Errors.internal().statusCode).toBe(500);
    expect(Errors.badRequest('x').code).toBe('VALIDATION_ERROR');
    expect(Errors.notFound('User').message).toMatch(/User not found/);
  });
});

describe('errorHandler', () => {
  it('serializes AppError', async () => {
    const res = await request(makeApp(Errors.conflict('duplicate'))).get('/boom');
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      success: false,
      error: { code: 'CONFLICT', message: 'duplicate' },
    });
  });

  it('wraps ZodError as 400 VALIDATION_ERROR with details', async () => {
    const schema = z.object({ n: z.number() });
    let zodErr: z.ZodError | undefined;
    try {
      schema.parse({ n: 'nope' });
    } catch (e) {
      zodErr = e as z.ZodError;
    }
    const res = await request(makeApp(zodErr)).get('/boom');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details).toBeDefined();
  });

  it('maps Postgres 23505 to CONFLICT', async () => {
    const dbErr = Object.assign(new Error('duplicate key'), {
      code: '23505',
      constraint: 'users_phone_key',
    });
    const res = await request(makeApp(dbErr)).get('/boom');
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });

  it('maps Postgres 22P02 (invalid uuid) to 400', async () => {
    const dbErr = Object.assign(new Error('invalid uuid'), { code: '22P02' });
    const res = await request(makeApp(dbErr)).get('/boom');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('unknown error → 500 INTERNAL_ERROR', async () => {
    const res = await request(makeApp(new Error('oops'))).get('/boom');
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
  });
});

describe('notFoundHandler', () => {
  it('returns 404 for unmatched routes', async () => {
    const app = express();
    app.use(notFoundHandler);
    app.use(errorHandler);
    const res = await request(app).get('/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});
