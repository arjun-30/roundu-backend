import { Response } from 'express';
import {
  ok,
  created,
  noContent,
  sendSuccess,
  paginated,
  buildPaginationMeta,
} from '../../src/utils/response';

function makeRes() {
  const res: Partial<Response> & {
    _status?: number;
    _body?: unknown;
    _sent?: boolean;
  } = {
    _sent: false,
    status(code: number) {
      this._status = code;
      return this as unknown as Response;
    },
    json(body: unknown) {
      this._body = body;
      return this as unknown as Response;
    },
    send() {
      this._sent = true;
      return this as unknown as Response;
    },
  };
  return res;
}

describe('response helpers', () => {
  it('ok returns 200 with envelope', () => {
    const res = makeRes();
    ok(res as unknown as Response, { x: 1 });
    expect(res._status).toBe(200);
    expect(res._body).toEqual({ success: true, data: { x: 1 }, message: 'Success', error: null });
  });

  it('sendSuccess is an alias for ok', () => {
    expect(sendSuccess).toBe(ok);
  });

  it('created returns 201', () => {
    const res = makeRes();
    created(res as unknown as Response, { id: '1' }, 'New');
    expect(res._status).toBe(201);
    expect(res._body).toMatchObject({ success: true, data: { id: '1' }, message: 'New' });
  });

  it('noContent returns 204 with no body', () => {
    const res = makeRes();
    noContent(res as unknown as Response);
    expect(res._status).toBe(204);
    expect(res._sent).toBe(true);
  });

  it('paginated returns 200 with data + meta', () => {
    const res = makeRes();
    const meta = buildPaginationMeta(1, 10, 25);
    paginated(res as unknown as Response, [1, 2, 3], meta);
    expect(res._status).toBe(200);
    expect(res._body).toMatchObject({
      success: true,
      data: [1, 2, 3],
      meta,
    });
  });
});

describe('buildPaginationMeta', () => {
  it('computes totalPages via ceil', () => {
    expect(buildPaginationMeta(1, 10, 25)).toEqual({
      currentPage: 1,
      totalPages: 3,
      totalCount: 25,
      limit: 10,
      hasNextPage: true,
      hasPrevPage: false,
    });
  });

  it('last page has hasNextPage=false and hasPrevPage=true', () => {
    const meta = buildPaginationMeta(3, 10, 25);
    expect(meta.hasNextPage).toBe(false);
    expect(meta.hasPrevPage).toBe(true);
  });

  it('single page has both false', () => {
    const meta = buildPaginationMeta(1, 10, 5);
    expect(meta.totalPages).toBe(1);
    expect(meta.hasNextPage).toBe(false);
    expect(meta.hasPrevPage).toBe(false);
  });

  it('empty result: 0 pages', () => {
    const meta = buildPaginationMeta(1, 10, 0);
    expect(meta.totalPages).toBe(0);
    expect(meta.totalCount).toBe(0);
  });

  it('limit=0 guards against divide-by-zero', () => {
    const meta = buildPaginationMeta(1, 0, 10);
    expect(meta.totalPages).toBe(0);
  });
});
