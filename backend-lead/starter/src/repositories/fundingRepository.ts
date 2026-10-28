import { CreationAttributes, Transaction } from 'sequelize';
import { FundingTransaction } from '../db/models';

/** Inserts a funding transaction in the caller's transaction without moving wallet money. */
export function create(
  values: CreationAttributes<FundingTransaction>, transaction: Transaction,
): Promise<FundingTransaction> {
  return FundingTransaction.create(values, { transaction });
}

/**
 * Finds a deposit by PSP reference and locks it FOR UPDATE until transaction end.
 *
 * @returns The locked deposit, or `null` for an unknown reference.
 * @remarks Acquire this lock before any associated wallet lock in callback flows.
 */
export function lockDepositByPspRef(
  pspRef: string, transaction: Transaction,
): Promise<FundingTransaction | null> {
  return FundingTransaction.findOne({
    where: { pspRef, type: 'Deposit' }, transaction, lock: transaction.LOCK.UPDATE,
  });
}

/** Persists funding changes in the supplied transaction; the caller owns transition checks and locking. */
export function save(funding: FundingTransaction, transaction: Transaction): Promise<FundingTransaction> {
  return funding.save({ transaction });
}
