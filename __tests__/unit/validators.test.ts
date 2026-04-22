import { applyReferralSchema } from '../../src/validators/referral.validator';
import { startTrackingSchema, updateLocationSchema } from '../../src/validators/tracking.validator';

const VALID_UUID = '11111111-1111-4111-8111-111111111111';

describe('applyReferralSchema', () => {
  it('accepts a valid code and normalizes to uppercase', () => {
    const r = applyReferralSchema.parse({ body: { code: 'arjun30' } });
    expect(r.body.code).toBe('ARJUN30');
  });

  it('trims surrounding whitespace', () => {
    const r = applyReferralSchema.parse({ body: { code: '  code1  ' } });
    expect(r.body.code).toBe('CODE1');
  });

  it('rejects codes shorter than 4 chars', () => {
    expect(() => applyReferralSchema.parse({ body: { code: 'ab' } })).toThrow();
  });

  it('rejects codes longer than 20 chars', () => {
    expect(() =>
      applyReferralSchema.parse({ body: { code: 'a'.repeat(21) } }),
    ).toThrow();
  });

  it('rejects missing code', () => {
    expect(() => applyReferralSchema.parse({ body: {} })).toThrow();
  });

  it('rejects non-string code', () => {
    expect(() => applyReferralSchema.parse({ body: { code: 123 } })).toThrow();
  });
});

describe('startTrackingSchema', () => {
  it('accepts a valid UUID bookingId', () => {
    const r = startTrackingSchema.parse({ body: { bookingId: VALID_UUID } });
    expect(r.body.bookingId).toBe(VALID_UUID);
  });

  it('rejects a non-UUID bookingId', () => {
    expect(() =>
      startTrackingSchema.parse({ body: { bookingId: 'not-a-uuid' } }),
    ).toThrow();
  });
});

describe('updateLocationSchema', () => {
  const goodParams = { sessionId: VALID_UUID };

  it('accepts valid lat/lng', () => {
    const r = updateLocationSchema.parse({
      body: { lat: 12.97, lng: 77.59 },
      params: goodParams,
    });
    expect(r.body.lat).toBe(12.97);
    expect(r.body.lng).toBe(77.59);
  });

  it('accepts optional accuracy', () => {
    const r = updateLocationSchema.parse({
      body: { lat: 0, lng: 0, accuracy: 5 },
      params: goodParams,
    });
    expect(r.body.accuracy).toBe(5);
  });

  it('rejects lat > 90', () => {
    expect(() =>
      updateLocationSchema.parse({ body: { lat: 90.01, lng: 0 }, params: goodParams }),
    ).toThrow();
  });

  it('rejects lng < -180', () => {
    expect(() =>
      updateLocationSchema.parse({ body: { lat: 0, lng: -180.01 }, params: goodParams }),
    ).toThrow();
  });

  it('rejects negative or zero accuracy', () => {
    expect(() =>
      updateLocationSchema.parse({
        body: { lat: 0, lng: 0, accuracy: 0 },
        params: goodParams,
      }),
    ).toThrow();
  });

  it('rejects non-UUID sessionId param', () => {
    expect(() =>
      updateLocationSchema.parse({
        body: { lat: 0, lng: 0 },
        params: { sessionId: 'bad' },
      }),
    ).toThrow();
  });
});
