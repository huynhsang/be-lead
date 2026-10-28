import { ServiceError } from './errors';

/** Direction of an external funding operation relative to the wallet. */
export type FundingType = 'Deposit' | 'Withdrawal';
/** Persisted funding state; completed and failed are terminal. */
export type FundingStatus = 'Pending' | 'Completed' | 'Failed';
/** Terminal statuses accepted by the mock PSP callback API. */
export type CallbackStatus = 'completed' | 'failed';
/** Ledger operation, including the migration baseline for existing balances. */
export type LedgerKind = 'Opening' | 'Deposit' | 'Wager' | 'Withdrawal';

/**
 * Checks whether a terminal callback requires a funding state change.
 *
 * @returns `true` for Pending to terminal, or `false` for an identical terminal retry.
 * @throws {@link ServiceError} with status 409 for conflicting terminal states.
 */
export function shouldTransition(current: FundingStatus, target: Exclude<FundingStatus, 'Pending'>): boolean {
  if (current === target) return false;
  if (current !== 'Pending') {
    throw new ServiceError(409, 'invalid_funding_transition');
  }
  return true;
}
