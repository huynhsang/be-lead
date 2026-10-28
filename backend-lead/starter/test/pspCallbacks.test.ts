import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { FundingTransaction, WalletTx } from '../src/db/models';
import { dec, money } from '../src/lib/money';
import * as ledgerRepository from '../src/repositories/ledgerRepository';
import {
  app,
  assertWallet,
  callback,
  contended,
  createMember,
  deposit,
  fund,
  registerDbLifecycle,
} from './support/moneyFlowHarness';

registerDbLifecycle();

describe('PSP callbacks', () => {
  it('credits sequential duplicate callbacks and their turnover exactly once', async () => {
    const { memberId, walletId } = await createMember();
    const response = await deposit(memberId, '100.50', 2);
    await callback(response.body.pspRef, '100.50').expect(200);
    await callback(response.body.pspRef, '100.5000').expect(200);
    expect((await FundingTransaction.findByPk(response.body.id))!.status).toBe('Completed');
    expect(await WalletTx.count()).toBe(1);
    await assertWallet(walletId, '100.50', '201');
  });

  it('credits concurrent duplicate callbacks exactly once under verified row contention', async () => {
    const { memberId, walletId } = await createMember();
    const response = await deposit(memberId, '100.50', 2);
    const results = await contended(walletId, [
      () => callback(response.body.pspRef, '100.50'),
      () => callback(response.body.pspRef, '100.50'),
    ]);
    expect(results.map((result) => result.status)).toEqual([200, 200]);
    expect(await WalletTx.count()).toBe(1);
    await assertWallet(walletId, '100.50', '201');
  });

  it('serializes different deposits into the same wallet without losing credits or turnover', async () => {
    const { memberId, walletId } = await createMember();
    const first = await deposit(memberId, '10.10', 2);
    const second = await deposit(memberId, '20.20', 3);
    const results = await contended(walletId, [
      () => callback(first.body.pspRef, '10.10'),
      () => callback(second.body.pspRef, '20.20'),
    ]);
    expect(results.map((result) => result.status)).toEqual([200, 200]);
    expect(await WalletTx.count()).toBe(2);
    await assertWallet(walletId, '30.30', '80.80');
  });

  it('fails a deposit without crediting, accepts identical failure retries and rejects late success', async () => {
    const { memberId, walletId } = await createMember();
    const response = await deposit(memberId, '10');
    await callback(response.body.pspRef, '10', 'failed').expect(200);
    await callback(response.body.pspRef, '10', 'failed').expect(200);
    const conflict = await callback(response.body.pspRef, '10').expect(409);
    expect(conflict.body.error).toBe('invalid_funding_transition');
    expect((await FundingTransaction.findByPk(response.body.id))!.status).toBe('Failed');
    expect(await WalletTx.count()).toBe(0);
    await assertWallet(walletId, '0');
  });

  it('rejects a failure after completion without reversing money', async () => {
    const { memberId, walletId } = await createMember();
    const response = await fund(memberId, '10', 2);
    await callback(response.body.pspRef, '10', 'failed').expect(409);
    expect((await FundingTransaction.findByPk(response.body.id))!.status).toBe('Completed');
    expect(await WalletTx.count()).toBe(1);
    await assertWallet(walletId, '10', '20');
  });

  it('resolves concurrent conflicting terminal callbacks to exactly one terminal outcome', async () => {
    const { memberId, walletId } = await createMember();
    const response = await deposit(memberId, '10');
    const results = await Promise.all([
      callback(response.body.pspRef, '10'),
      callback(response.body.pspRef, '10', 'failed'),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
    const funding = await FundingTransaction.findByPk(response.body.id);
    const completed = funding!.status === 'Completed';
    expect(await WalletTx.count()).toBe(completed ? 1 : 0);
    await assertWallet(walletId, completed ? '10' : '0', completed ? '10' : '0');
  });

  it.each(['completed', 'failed'])('rejects mismatched %s callback amounts without changing state', async (status) => {
    const { memberId, walletId } = await createMember();
    const response = await deposit(memberId, '100.50');
    const mismatch = await callback(response.body.pspRef, '100.51', status).expect(409);
    expect(mismatch.body.error).toBe('callback_amount_mismatch');
    expect((await FundingTransaction.findByPk(response.body.id))!.status).toBe('Pending');
    expect(await WalletTx.count()).toBe(0);
    await assertWallet(walletId, '0');
    await callback(response.body.pspRef, '100.50').expect(200);
    await callback(response.body.pspRef, '100.51').expect(409);
    await assertWallet(walletId, '100.50', '100.50');
  });

  it('rejects unknown references and invalid callback statuses', async () => {
    await callback(randomUUID(), '1').expect(404);
    await callback(randomUUID(), '1', 'pending').expect(400);
    expect(await FundingTransaction.count()).toBe(0);
    expect(await WalletTx.count()).toBe(0);
  });

  it.each([
    '0', '-1', '1e2', 'NaN', 'Infinity', '', ' 1', '01', '0.0000000000000000001',
    '1000000000000000000', 1, null,
  ])('rejects invalid callback amounts %p', async (amount) => {
    await callback(randomUUID(), amount).expect(400);
    expect(await FundingTransaction.count()).toBe(0);
    expect(await WalletTx.count()).toBe(0);
  });

  it('rolls back completion when the wallet balance would overflow', async () => {
    const { memberId, walletId } = await createMember();
    await fund(memberId, '999999999999999999.999999999999999999');
    const response = await deposit(memberId, '0.000000000000000001', 0);
    const overflow = await callback(response.body.pspRef, '0.000000000000000001').expect(422);
    expect(overflow.body.error).toBe('money_limit_exceeded');
    expect((await FundingTransaction.findByPk(response.body.id))!.status).toBe('Pending');
    expect(await WalletTx.count()).toBe(1);
    await assertWallet(walletId, '999999999999999999.999999999999999999');
  });

  it('rolls back credit when cumulative required turnover would overflow', async () => {
    const { memberId, walletId } = await createMember();
    await fund(memberId, '499999999999999999', 2);
    const response = await deposit(memberId, '1', 2);
    await callback(response.body.pspRef, '1').expect(422);
    expect((await FundingTransaction.findByPk(response.body.id))!.status).toBe('Pending');
    expect(await WalletTx.count()).toBe(1);
    await assertWallet(walletId, '499999999999999999', '999999999999999998');
  });

  it('rolls back every write if callback ledger insert fails', async () => {
    const { memberId, walletId } = await createMember();
    const initial = await fund(memberId, '10');
    const pending = await deposit(memberId, '5', 2);
    const failure = new Error('ledger unavailable');
    const log = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.spyOn(ledgerRepository, 'append').mockRejectedValueOnce(failure);
    await callback(pending.body.pspRef, '5').expect(500);
    expect(log).toHaveBeenCalledWith(failure);
    expect((await FundingTransaction.findByPk(initial.body.id))!.status).toBe('Completed');
    expect((await FundingTransaction.findByPk(pending.body.id))!.status).toBe('Pending');
    expect(await FundingTransaction.count()).toBe(2);
    expect(await WalletTx.count()).toBe(1);
    await assertWallet(walletId, '10');
  });

  it('enforces append-only ledger entries and unique funding credits in PostgreSQL', async () => {
    const { memberId, walletId } = await createMember();
    const response = await fund(memberId, '10');
    const entry = await WalletTx.findOne({ where: { fundingTransactionId: response.body.id } });
    await expect(entry!.update({ amount: '11' })).rejects.toThrow('append-only');
    await expect(entry!.destroy()).rejects.toThrow('append-only');
    await expect(WalletTx.create({
      walletId,
      fundingTransactionId: response.body.id,
      kind: 'Deposit',
      amount: money(dec('10')),
      balanceAfter: money(dec('20')),
    })).rejects.toThrow();
    expect(await WalletTx.count()).toBe(1);
    await assertWallet(walletId, '10');
  });
});
