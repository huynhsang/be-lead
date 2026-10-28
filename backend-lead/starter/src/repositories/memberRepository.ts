import { Transaction } from 'sequelize';
import { Member } from '../db/models';

/** Inserts a member in the supplied transaction; database uniqueness errors propagate unchanged. */
export function create(username: string, transaction: Transaction): Promise<Member> {
  return Member.create({ username }, { transaction });
}
