import { randomUUID } from 'node:crypto';
import { CallbackStatus, shouldTransition } from '../domain/funding';
import { ServiceError } from '../domain/errors';
import { dec, money } from '../lib/money';
import * as fundingRepository from '../repositories/fundingRepository';
import * as ledgerRepository from '../repositories/ledgerRepository';
import * as walletRepository from '../repositories/walletRepository';
import { inTransaction } from '../db/transaction';

/**
 * Creates a pending deposit with a generated PSP reference; no money moves yet.
 *
 * @param memberId - Member UUID validated by the route.
 * @param amount - Validated positive decimal string fitting DECIMAL(36,18).
 * @param turnoverMultiplier - Validated nonnegative PostgreSQL INTEGER.
 * @returns The persisted pending funding transaction.
 * @throws {@link ServiceError} with status 404 if the member has no wallet, or
 * status 422 if the deposit's turnover requirement cannot fit in storage.
 */
export async function createDeposit(memberId: string, amount: string, turnoverMultiplier: number) {
  // Reject an unrepresentable requirement before accepting a payment.
  money(dec(amount).times(turnoverMultiplier));
  return inTransaction(async (t) => {
    const wallet = await walletRepository.findByMemberId(memberId, t);
    if (!wallet) throw new ServiceError(404, 'wallet_not_found');
    return fundingRepository.create({
      walletId: wallet.id,
      type: 'Deposit',
      status: 'Pending',
      amount: money(dec(amount)),
      pspRef: randomUUID(),
      turnoverMultiplier,
    }, t);
  });
}

/**
 * Applies a mock PSP terminal callback with an exactly-once deposit credit.
 *
 * @remarks Locks funding before wallet inside one transaction. Completion updates
 * balance, lifetime required turnover, ledger and funding state atomically.
 * A matching terminal retry returns the existing funding row without further writes.
 * Failed deposits never affect balance or turnover. This function does not verify
 * provider signatures; the mock route validates input only.
 * @param pspRef - Opaque reference generated when the deposit was created.
 * @param status - Validated terminal callback status.
 * @param amount - Validated positive decimal string; must numerically equal the
 * original deposit amount, including on retries and failure notifications.
 * @returns The terminal funding transaction.
 * @throws {@link ServiceError} with status 404 for missing funding or wallet,
 * 409 for amount mismatch or conflicting terminal state, or 422 for money overflow.
 */
export async function handleCallback(pspRef: string, status: CallbackStatus, amount: string) {
  return inTransaction(async (t) => {
    // Always lock funding before wallet; no path takes these existing locks in reverse.
    const funding = await fundingRepository.lockDepositByPspRef(pspRef, t);
    if (!funding) throw new ServiceError(404, 'funding_transaction_not_found');
    if (!dec(funding.amount).eq(dec(amount))) {
      throw new ServiceError(409, 'callback_amount_mismatch');
    }
    const target = status === 'completed' ? 'Completed' : 'Failed';
    if (!shouldTransition(funding.status, target)) return funding;

    if (target === 'Completed') {
      const wallet = await walletRepository.lockById(funding.walletId, t);
      if (!wallet) throw new ServiceError(404, 'wallet_not_found');
      wallet.balance = money(dec(wallet.balance).plus(funding.amount));
      wallet.requiredTurnover = money(
        dec(wallet.requiredTurnover).plus(dec(funding.amount).times(funding.turnoverMultiplier)),
      );
      await walletRepository.save(wallet, t);
      await ledgerRepository.append({
        walletId: wallet.id,
        fundingTransactionId: funding.id,
        kind: 'Deposit',
        amount: funding.amount,
        balanceAfter: wallet.balance,
      }, t);
    }
    funding.status = target;
    return fundingRepository.save(funding, t);
  });
}
