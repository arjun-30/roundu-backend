import { calculateRefund, isRefundEligible } from '../../src/utils/cancellation-slabs';

const HOUR_MS = 60 * 60 * 1000;

function cancelAt(hoursBefore: number) {
  const scheduled = new Date('2026-05-01T12:00:00Z');
  const cancelled = new Date(scheduled.getTime() - hoursBefore * HOUR_MS);
  return { scheduled, cancelled };
}

describe('calculateRefund', () => {
  const total = 10_000;

  it('returns 100% refund for ≥ 48h before service', () => {
    const { scheduled, cancelled } = cancelAt(72);
    const r = calculateRefund(scheduled, total, cancelled);
    expect(r.refundPercent).toBe(100);
    expect(r.refundAmount).toBe(10_000);
    expect(r.deductedAmount).toBe(0);
  });

  it('returns 100% refund at exactly 48h (boundary)', () => {
    const { scheduled, cancelled } = cancelAt(48);
    expect(calculateRefund(scheduled, total, cancelled).refundPercent).toBe(100);
  });

  it('returns 75% just under 48h', () => {
    const { scheduled, cancelled } = cancelAt(47.99);
    expect(calculateRefund(scheduled, total, cancelled).refundPercent).toBe(75);
  });

  it('returns 75% refund for 24–48h', () => {
    const { scheduled, cancelled } = cancelAt(30);
    const r = calculateRefund(scheduled, total, cancelled);
    expect(r.refundPercent).toBe(75);
    expect(r.refundAmount).toBe(7_500);
  });

  it('returns 50% refund for 12–24h', () => {
    const { scheduled, cancelled } = cancelAt(18);
    expect(calculateRefund(scheduled, total, cancelled).refundPercent).toBe(50);
  });

  it('returns 25% refund for 6–12h', () => {
    const { scheduled, cancelled } = cancelAt(8);
    expect(calculateRefund(scheduled, total, cancelled).refundPercent).toBe(25);
  });

  it('returns 10% refund for 3–6h', () => {
    const { scheduled, cancelled } = cancelAt(4);
    expect(calculateRefund(scheduled, total, cancelled).refundPercent).toBe(10);
  });

  it('returns 0% refund when < 3h', () => {
    const { scheduled, cancelled } = cancelAt(1);
    expect(calculateRefund(scheduled, total, cancelled).refundPercent).toBe(0);
  });

  it('returns 0% refund when cancelled after scheduled time', () => {
    const scheduled = new Date('2026-05-01T12:00:00Z');
    const cancelled = new Date(scheduled.getTime() + 2 * HOUR_MS);
    expect(calculateRefund(scheduled, total, cancelled).refundPercent).toBe(0);
  });

  it('floors fractional refund paise (no rounding up)', () => {
    const { scheduled, cancelled } = cancelAt(5); // 10% slab
    const r = calculateRefund(scheduled, 999, cancelled);
    expect(r.refundAmount).toBe(99);
    expect(r.deductedAmount).toBe(900);
    expect(r.refundAmount + r.deductedAmount).toBe(999);
  });

  it('conservation: refundAmount + deductedAmount == total for all slabs', () => {
    const cases = [72, 48, 36, 24, 18, 12, 8, 6, 4, 3, 2, 0.5];
    const scheduled = new Date('2026-05-01T12:00:00Z');
    for (const h of cases) {
      const cancelled = new Date(scheduled.getTime() - h * HOUR_MS);
      const r = calculateRefund(scheduled, 12_345, cancelled);
      expect(r.refundAmount + r.deductedAmount).toBe(12_345);
    }
  });

  it('accepts ISO strings for scheduled/cancelled', () => {
    const r = calculateRefund('2026-05-01T12:00:00Z', 10_000, '2026-04-28T12:00:00Z');
    expect(r.refundPercent).toBe(100);
  });

  it('defaults cancelledAt to now when omitted', () => {
    const futureScheduled = new Date(Date.now() + 72 * HOUR_MS);
    expect(calculateRefund(futureScheduled, 10_000).refundPercent).toBe(100);
  });
});

describe('isRefundEligible', () => {
  it('is true for cancellations ≥ 3h before service', () => {
    expect(isRefundEligible(new Date(Date.now() + 4 * HOUR_MS))).toBe(true);
  });

  it('is false for cancellations < 3h before service', () => {
    expect(isRefundEligible(new Date(Date.now() + 2 * HOUR_MS))).toBe(false);
  });

  it('is false when cancellation is after scheduled time', () => {
    expect(isRefundEligible(new Date(Date.now() - HOUR_MS))).toBe(false);
  });
});
