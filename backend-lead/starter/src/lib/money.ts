import BigNumber from 'bignumber.js';
import { ServiceError } from '../domain/errors';

// Money invariants for this codebase:
// - Money is stored as DECIMAL(36,18) in Postgres and travels as strings in JS/JSON.
// - All arithmetic on money MUST go through BigNumber. Never use JS number math on money.
BigNumber.config({ DECIMAL_PLACES: 18, ROUNDING_MODE: BigNumber.ROUND_DOWN });

/**
 * Parses a finite decimal without converting money through a JavaScript number.
 *
 * @remarks This is not HTTP input validation and does not enforce storage limits.
 * Use `money` before persistence and the route amount schema for external input.
 * @throws {@link Error} if the value is NaN or infinite.
 */
export function dec(value: string | BigNumber): BigNumber {
  const bn = new BigNumber(value);
  if (!bn.isFinite()) {
    throw new Error(`Invalid money value: ${value}`);
  }
  return bn;
}

/** Exact zero for BigNumber arithmetic and ledger reductions. */
export const ZERO = dec('0');
/** Largest positive value representable by PostgreSQL DECIMAL(36,18). */
export const MAX_MONEY = dec('999999999999999999.999999999999999999');

/**
 * Formats a signed decimal as a fixed-scale string fitting DECIMAL(36,18).
 *
 * @remarks Rejects excess precision instead of silently rounding. Negative values
 * are supported for ledger debits; positivity is validated at the HTTP boundary.
 * @throws {@link ServiceError} with status 422 and code `money_limit_exceeded`
 * if the value is non-finite, exceeds the magnitude limit, or has over 18 decimal places.
 */
export function money(value: BigNumber): string {
  if (!value.isFinite() || value.abs().gt(MAX_MONEY) || value.decimalPlaces()! > 18) {
    throw new ServiceError(422, 'money_limit_exceeded');
  }
  return value.toFixed(18);
}
