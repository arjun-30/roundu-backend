export interface RefundResult {
  refundPercent: number;
  refundAmount: number;
  deductedAmount: number;
  slabLabel: string;
}

/**
 * Calculates refund amount based on how far in advance the booking is cancelled.
 * Mirrors IRCTC cancellation slab logic.
 *
 * @param scheduledAt   - ISO datetime of the booking
 * @param cancelledAt   - ISO datetime of cancellation (defaults to now)
 * @param totalAmount   - Total paid amount in paise (smallest currency unit)
 */
export function calculateRefund(
  scheduledAt: Date | string,
  totalAmount: number,
  cancelledAt: Date | string = new Date()
): RefundResult {
  const scheduled = new Date(scheduledAt).getTime();
  const cancelled = new Date(cancelledAt).getTime();

  const hoursBeforeService = (scheduled - cancelled) / (1000 * 60 * 60);

  let refundPercent: number;
  let slabLabel: string;

  if (hoursBeforeService >= 48) {
    refundPercent = 100;
    slabLabel = '48h+ before service (full refund)';
  } else if (hoursBeforeService >= 24) {
    refundPercent = 75;
    slabLabel = '24–48h before service (75% refund)';
  } else if (hoursBeforeService >= 12) {
    refundPercent = 50;
    slabLabel = '12–24h before service (50% refund)';
  } else if (hoursBeforeService >= 6) {
    refundPercent = 25;
    slabLabel = '6–12h before service (25% refund)';
  } else if (hoursBeforeService >= 3) {
    refundPercent = 10;
    slabLabel = '3–6h before service (10% refund)';
  } else {
    refundPercent = 0;
    slabLabel = 'Less than 3h before service (no refund)';
  }

  const refundAmount = Math.floor((totalAmount * refundPercent) / 100);
  const deductedAmount = totalAmount - refundAmount;

  return {
    refundPercent,
    refundAmount,
    deductedAmount,
    slabLabel,
  };
}

/**
 * Returns whether a booking is eligible for any refund at all.
 */
export function isRefundEligible(
  scheduledAt: Date | string,
  cancelledAt: Date | string = new Date()
): boolean {
  const scheduled = new Date(scheduledAt).getTime();
  const cancelled = new Date(cancelledAt).getTime();
  const hoursBeforeService = (scheduled - cancelled) / (1000 * 60 * 60);
  return hoursBeforeService >= 3;
}
