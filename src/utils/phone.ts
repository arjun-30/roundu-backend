// TECH LEAD — Indian phone validation + normalisation
// All phone numbers in the system are stored and sent as "91XXXXXXXXXX" (12 digits, no +).

/**
 * Normalise any Indian phone string to the format "91XXXXXXXXXX".
 *
 * Accepts:
 *   +91-9876543210  →  "919876543210"
 *   +919876543210   →  "919876543210"
 *   09876543210     →  "919876543210"
 *   9876543210      →  "919876543210"
 *   919876543210    →  "919876543210"  (already normalised)
 *
 * Returns null if the number is not a valid 10-digit Indian mobile number
 * (must start with 6, 7, 8, or 9).
 */
export function normalizePhone(raw: string): string | null {
  // Strip everything except digits
  const digits = raw.replace(/\D/g, '');

  let local: string;

  if (digits.length === 10) {
    local = digits;
  } else if (digits.length === 11 && digits.startsWith('0')) {
    local = digits.slice(1);
  } else if (digits.length === 12 && digits.startsWith('91')) {
    local = digits.slice(2);
  } else if (digits.length === 13 && digits.startsWith('091')) {
    local = digits.slice(3);
  } else {
    return null;
  }

  // Indian mobile numbers start with 6, 7, 8 or 9
  if (!/^[6-9]\d{9}$/.test(local)) {
    return null;
  }

  return `91${local}`;
}

/**
 * Returns true if the string is a valid normalised Indian phone number.
 * Useful for Zod `.refine()` clauses.
 */
export function isValidIndianPhone(phone: string): boolean {
  return normalizePhone(phone) !== null;
}

/**
 * Format a normalised number for display: "+91 98765 43210"
 */
export function formatPhoneForDisplay(normalized: string): string {
  // "919876543210" → "+91 98765 43210"
  const local = normalized.startsWith('91') ? normalized.slice(2) : normalized;
  return `+91 ${local.slice(0, 5)} ${local.slice(5)}`;
}
