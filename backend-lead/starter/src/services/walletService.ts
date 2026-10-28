import { ServiceError } from '../domain/errors';
import { dec, money } from '../lib/money';
import * as fundingRepository from '../repositories/fundingRepository';
import * as ledgerRepository from '../repositories/ledgerRepository';
import * as walletRepository from '../repositories/walletRepository';
import { inTransaction } from '../db/transaction';

/**
 * Atomically debits a wager, accrues lifetime turnover and appends a negative ledger delta.
 *
 * @remarks Locks the wallet before checking balance so concurrent debits cannot
 * overdraw it. Repeated requests are separate wagers, not idempotent retries.
 * @param walletId - Wallet UUID validated by the route.
 * @param amount - Validated positive decimal string fitting DECIMAL(36,18).
 * @returns Wager and wallet IDs, resulting balance and accrued turnover as strings.
 * @throws {@link ServiceError} with status 404 for a missing wallet, or 422 for
 * insufficient balance or accrued-turnover overflow.
 */
export async function recordWager(walletId: string, amount: string) {
  return inTransaction(async (t) => {
    const wallet = await walletRepository.lockById(walletId, t);
    if (!wallet) throw new ServiceError(404, 'wallet_not_found');
    if (dec(wallet.balance).lt(amount)) throw new ServiceError(422, 'insufficient_balance');

    wallet.balance = money(dec(wallet.balance).minus(amount));
    wallet.accruedTurnover = money(dec(wallet.accruedTurnover).plus(amount));
    await walletRepository.save(wallet, t);
    const wager = await ledgerRepository.append({
      walletId: wallet.id,
      fundingTransactionId: null,
      kind: 'Wager',
      amount: money(dec(amount).negated()),
      balanceAfter: wallet.balance,
    }, t);
    return { id: wager.id, walletId: wallet.id, balance: wallet.balance, accruedTurnover: wallet.accruedTurnover };
  });
}

/**
 * Debits an unlocked wallet and creates a pending withdrawal with a ledger entry.
 *
 * @remarks All writes share one transaction and a wallet row lock. Turnover is
 * checked before balance; lifetime counters are not reset. No payout or approval
 * is performed, and repeated requests create separate withdrawals.
 * @param memberId - Member UUID validated by the route.
 * @param amount - Validated positive decimal string fitting DECIMAL(36,18).
 * @returns The pending funding transaction, with the wallet already debited.
 * @throws {@link ServiceError} with status 404 for a missing wallet, or 422 for
 * outstanding turnover (`details.outstandingTurnover`) or insufficient balance.
 */
export async function createWithdrawal(memberId: string, amount: string) {
  return inTransaction(async (t) => {
    const wallet = await walletRepository.lockByMemberId(memberId, t);
    if (!wallet) throw new ServiceError(404, 'wallet_not_found');
    const outstanding = dec(wallet.requiredTurnover).minus(wallet.accruedTurnover);
    if (outstanding.gt('0')) {
      throw new ServiceError(422, 'turnover_locked', { outstandingTurnover: money(outstanding) });
    }
    if (dec(wallet.balance).lt(amount)) throw new ServiceError(422, 'insufficient_balance');

    const funding = await fundingRepository.create({
      walletId: wallet.id,
      type: 'Withdrawal',
      status: 'Pending',
      amount: money(dec(amount)),
      pspRef: null,
      turnoverMultiplier: 0,
    }, t);
    wallet.balance = money(dec(wallet.balance).minus(amount));
    await walletRepository.save(wallet, t);
    await ledgerRepository.append({
      walletId: wallet.id,
      fundingTransactionId: funding.id,
      kind: 'Withdrawal',
      amount: money(dec(amount).negated()),
      balanceAfter: wallet.balance,
    }, t);
    return funding;
  });
}
