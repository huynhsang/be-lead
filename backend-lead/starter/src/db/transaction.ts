import { Transaction } from 'sequelize';
import { sequelize } from './sequelize';

type TransactionIsolationLevel =
  (typeof Transaction.ISOLATION_LEVELS)[keyof typeof Transaction.ISOLATION_LEVELS];

/**
 * Executes awaited database work in a managed transaction.
 *
 * @param work - Callback that must pass the supplied transaction to every query
 * participating in the atomic operation.
 * @returns The callback result after commit; a rejection rolls back and propagates.
 * @param isolationLevel - Optional transaction isolation level. Defaults to READ COMMITTED.
 * @remarks Isolation alone does not serialize balance checks. Callers must
 * acquire the appropriate row locks before reading state they intend to mutate.
 */
export function inTransaction<T>(
  work: (transaction: Transaction) => Promise<T>,
  isolationLevel: TransactionIsolationLevel = Transaction.ISOLATION_LEVELS.READ_COMMITTED,
): Promise<T> {
  return sequelize.transaction({ isolationLevel }, work);
}
