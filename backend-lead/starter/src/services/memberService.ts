import { Member, Wallet } from '../db/models';
import * as memberRepository from '../repositories/memberRepository';
import * as walletRepository from '../repositories/walletRepository';
import { inTransaction } from '../db/transaction';

/**
 * Atomically creates a member and its zero-balance wallet.
 *
 * @param username - Username already validated by the HTTP route.
 * @returns The persisted member and wallet.
 * @remarks Database failures, including duplicate usernames, propagate to the caller.
 */
export async function createMember(username: string): Promise<{ member: Member; wallet: Wallet }> {
  return inTransaction(async (t) => {
    const member = await memberRepository.create(username, t);
    const wallet = await walletRepository.create(member.id, t);
    return { member, wallet };
  });
}

/**
 * Reads a member's wallet without acquiring a mutation lock.
 *
 * @returns The wallet, or `null` if no wallet exists for the member.
 */
export async function getWalletByMemberId(memberId: string): Promise<Wallet | null> {
  return walletRepository.findByMemberId(memberId);
}
