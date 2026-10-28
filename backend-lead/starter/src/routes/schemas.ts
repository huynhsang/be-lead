import { z } from 'zod';
import { dec } from '../lib/money';

/** UUID validation shared by member IDs and wallet IDs at the HTTP boundary. */
export const idSchema = z.string().uuid();
/**
 * Positive plain decimal string fitting DECIMAL(36,18), without normalization.
 *
 * @remarks Allows up to 18 integer and 18 fractional digits; rejects numeric JSON
 * values, exponent notation, whitespace, zero and unnecessary leading zeros.
 */
export const amountSchema = z.string()
  .regex(/^(0|[1-9]\d{0,17})(\.\d{1,18})?$/, 'Expected a decimal string fitting DECIMAL(36,18)')
  .pipe(z.string().refine((value) => dec(value).gt('0'), 'Amount must be positive'));

/** Shared validated request body for member-scoped deposits and withdrawals. */
export const memberAmountBody = z.object({
  memberId: idSchema,
  amount: amountSchema,
});
