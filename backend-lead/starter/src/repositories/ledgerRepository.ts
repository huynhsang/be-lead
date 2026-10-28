import { CreationAttributes, Transaction } from 'sequelize';
import { WalletTx } from '../db/models';

/**
 * Appends a signed ledger delta in the same transaction as the wallet balance change.
 *
 * @remarks Callers supply the resulting balance and any funding link. PostgreSQL
 * enforces entry signs, unique funding links and rejection of subsequent updates or deletes.
 */
export function append(values: CreationAttributes<WalletTx>, transaction: Transaction): Promise<WalletTx> {
  return WalletTx.create(values, { transaction });
}
