import {
  CreationOptional, DataTypes, InferAttributes, InferCreationAttributes, Model, Sequelize,
} from 'sequelize';
import { LedgerKind } from '../../domain/funding';

/**
 * Append-only balance delta used to reconstruct a wallet from its ledger.
 *
 * @remarks Migrations enforce immutability and create opening entries for existing
 * positive balances. There is no updatedAt column.
 */
export class WalletTx extends Model<InferAttributes<WalletTx>, InferCreationAttributes<WalletTx>> {
  declare id: CreationOptional<string>;
  declare walletId: string;
  /** Unique funding link for deposits/withdrawals; null for wagers and opening entries. */
  declare fundingTransactionId: string | null;
  declare kind: LedgerKind;
  /** Signed decimal delta: positive for deposits/opening entries, negative for wagers/withdrawals. */
  declare amount: string;
  /** Resulting wallet balance captured in the same transaction as this entry. */
  declare balanceAfter: string;
}

/** Registers the ledger table mapping; migrations install its append-only trigger. */
export function initWalletTx(sequelize: Sequelize): void {
  WalletTx.init({
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    walletId: { type: DataTypes.UUID, allowNull: false },
    fundingTransactionId: { type: DataTypes.UUID, allowNull: true, unique: true },
    kind: { type: DataTypes.STRING, allowNull: false },
    amount: { type: DataTypes.DECIMAL(36, 18), allowNull: false },
    balanceAfter: { type: DataTypes.DECIMAL(36, 18), allowNull: false },
  }, { sequelize, tableName: 'wallet_txs', underscored: true, updatedAt: false });
}
