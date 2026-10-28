import { Transaction } from 'sequelize';
import { Wallet } from '../db/models';

/** Creates a zero-balance wallet with default zero turnover counters in the supplied transaction. */
export function create(memberId: string, transaction: Transaction): Promise<Wallet> {
  return Wallet.create({ memberId, balance: '0' }, { transaction });
}

/** Reads a wallet without a mutation lock, returning `null` when the member has none. */
export function findByMemberId(memberId: string, transaction?: Transaction): Promise<Wallet | null> {
  return Wallet.findOne({ where: { memberId }, transaction });
}

/** Finds a member's wallet and holds a FOR UPDATE lock until transaction end; returns `null` if absent. */
export function lockByMemberId(memberId: string, transaction: Transaction): Promise<Wallet | null> {
  return Wallet.findOne({ where: { memberId }, transaction, lock: transaction.LOCK.UPDATE });
}

/** Finds a wallet by its own ID and holds a FOR UPDATE lock until transaction end; returns `null` if absent. */
export function lockById(id: string, transaction: Transaction): Promise<Wallet | null> {
  return Wallet.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
}

/** Saves wallet changes in the supplied transaction; callers must already hold its row lock. */
export function save(wallet: Wallet, transaction: Transaction): Promise<Wallet> {
  return wallet.save({ transaction });
}
