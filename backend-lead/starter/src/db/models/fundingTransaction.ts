import {
  CreationOptional, DataTypes, InferAttributes, InferCreationAttributes, Model, Sequelize,
} from 'sequelize';
import { FundingStatus, FundingType } from '../../domain/funding';

/**
 * External money operation tracked independently from its wallet ledger effect.
 *
 * @remarks Deposits credit only on completion. Withdrawals debit immediately while
 * still pending; payout approval and settlement are outside the current service.
 */
export class FundingTransaction extends Model<
  InferAttributes<FundingTransaction>, InferCreationAttributes<FundingTransaction>
> {
  declare id: CreationOptional<string>;
  declare walletId: string;
  declare type: FundingType;
  declare status: FundingStatus;
  /** Positive amount as a DECIMAL(36,18) string, regardless of operation direction. */
  declare amount: string;
  /** Unique callback reference for deposits; null for withdrawals. */
  declare pspRef: string | null;
  /** Integer requirement multiplier applied on deposit completion; zero for withdrawals. */
  declare turnoverMultiplier: number;
}

/** Registers the funding table mapping; migrations own its constraints and indexes. */
export function initFundingTransaction(sequelize: Sequelize): void {
  FundingTransaction.init({
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    walletId: { type: DataTypes.UUID, allowNull: false },
    type: { type: DataTypes.STRING, allowNull: false },
    status: { type: DataTypes.STRING, allowNull: false },
    amount: { type: DataTypes.DECIMAL(36, 18), allowNull: false },
    pspRef: { type: DataTypes.STRING, allowNull: true, unique: true },
    turnoverMultiplier: { type: DataTypes.INTEGER, allowNull: false },
  }, { sequelize, tableName: 'funding_transactions', underscored: true });
}
