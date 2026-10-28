import { DataTypes, Model, Sequelize } from 'sequelize';

/** Cached wallet balance and lifetime turnover totals, stored as exact decimal strings. */
export class Wallet extends Model {
  declare id: string;
  declare memberId: string;
  /** Current balance; PostgreSQL DECIMAL values must remain strings in JavaScript. */
  declare balance: string;
  /** Sum of amount times multiplier for completed deposits; withdrawals do not reset it. */
  declare requiredTurnover: string;
  /** Sum of accepted wager amounts, including turnover exceeding the current requirement. */
  declare accruedTurnover: string;
}

/** Registers the wallets table mapping and zero defaults; does not create database tables. */
export function initWallet(sequelize: Sequelize): void {
  Wallet.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      memberId: { type: DataTypes.UUID, allowNull: false },
      balance: { type: DataTypes.DECIMAL(36, 18), allowNull: false, defaultValue: '0' },
      requiredTurnover: { type: DataTypes.DECIMAL(36, 18), allowNull: false, defaultValue: '0' },
      accruedTurnover: { type: DataTypes.DECIMAL(36, 18), allowNull: false, defaultValue: '0' },
    },
    { sequelize, tableName: 'wallets', underscored: true },
  );
}
