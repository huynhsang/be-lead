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
  fund,
  registerDbLifecycle,
} from './support/moneyFlowHarness';

registerDbLifecycle();

describe('withdrawals', () => {
  it.each([
    '0', '-1', '1e2', 'NaN', 'Infinity', '', ' 1', '01', '0.0000000000000000001',
    '1000000000000000000', 1, null,
  ])('rejects invalid withdrawal amounts %p', async (amount) => {
    await request(app).post('/withdrawals').send({ memberId: randomUUID(), amount }).expect(400);
    expect(await FundingTransaction.count()).toBe(0);
    expect(await WalletTx.count()).toBe(0);
  });

  it('returns explicit validation and not-found errors for member identifiers', async () => {
    await request(app).post('/withdrawals').send({ memberId: 'bad', amount: '1' }).expect(400);
    await request(app).post('/withdrawals').send({ memberId: randomUUID(), amount: '1' }).expect(404);
  });

  it('blocks until cumulative turnover is met, debits withdrawal immediately and relocks for a new deposit', async () => {
    const { memberId, walletId } = await createMember();
    await fund(memberId, '10.25', 2);
    await fund(memberId, '5.25', 1);
    const reserve = await request(app).post('/deposits').send({ memberId, amount: '30', turnoverMultiplier: 0 }).expect(201);
    const failed = await request(app).post('/deposits').send({ memberId, amount: '50', turnoverMultiplier: 5 }).expect(201);
    await callback(failed.body.pspRef, '50', 'failed').expect(200);
    const locked = await request(app).post('/withdrawals').send({ memberId, amount: '1' }).expect(422);
    expect(locked.body).toEqual({
      error: 'turnover_locked', outstandingTurnover: money(dec('25.75')),
    });
    expect(await FundingTransaction.count({ where: { type: 'Withdrawal' } })).toBe(0);
    await request(app).post(`/wallets/${walletId}/wagers`).send({ amount: '15.50' }).expect(201);
    const partlyLocked = await request(app).post('/withdrawals').send({ memberId, amount: '1' }).expect(422);
    expect(partlyLocked.body.outstandingTurnover).toBe(money(dec('10.25')));
    await callback(reserve.body.pspRef, '30').expect(200);
    await request(app).post(`/wallets/${walletId}/wagers`).send({ amount: '10.25' }).expect(201);
    const withdrawal = await request(app).post('/withdrawals').send({ memberId, amount: '5' }).expect(201);
    expect(withdrawal.body).toMatchObject({ type: 'Withdrawal', status: 'Pending', amount: money(dec('5')) });
    await assertWallet(walletId, '14.75', '25.75', '25.75');

    await fund(memberId, '2', 3);
    const relocked = await request(app).post('/withdrawals').send({ memberId, amount: '1' }).expect(422);
    expect(relocked.body.outstandingTurnover).toBe(money(dec('6')));
    await assertWallet(walletId, '16.75', '31.75', '25.75');
  });

  it('retains excess accrued turnover rather than resetting it on withdrawal', async () => {
    const { memberId, walletId } = await createMember();
    await fund(memberId, '20', 0);
    await fund(memberId, '2', 1);
    await request(app).post(`/wallets/${walletId}/wagers`).send({ amount: '3' }).expect(201);
    await request(app).post('/withdrawals').send({ memberId, amount: '1' }).expect(201);
    await fund(memberId, '1', 1);
    await request(app).post('/withdrawals').send({ memberId, amount: '1' }).expect(201);
    await assertWallet(walletId, '18', '3', '3');
  });

  it('prevents concurrent withdrawals and mixed debits from overspending', async () => {
    const { memberId, walletId } = await createMember();
    await fund(memberId, '10');
    const withdrawals = await contended(walletId, [
      () => request(app).post('/withdrawals').send({ memberId, amount: '7' }),
      () => request(app).post('/withdrawals').send({ memberId, amount: '7' }),
    ]);
    expect(withdrawals.map((result) => result.status).sort()).toEqual([201, 422]);
    expect(await FundingTransaction.count({ where: { type: 'Withdrawal' } })).toBe(1);
    await assertWallet(walletId, '3');

    const mixed = await contended(walletId, [
      () => request(app).post('/withdrawals').send({ memberId, amount: '2' }),
      () => request(app).post(`/wallets/${walletId}/wagers`).send({ amount: '2' }),
    ]);
    expect(mixed.map((result) => result.status).sort()).toEqual([201, 422]);
    const wagerWon = mixed[1].status === 201;
    await assertWallet(walletId, '1', '0', wagerWon ? '2' : '0');
  });

  it('rejects insufficient funds without creating funding or ledger rows', async () => {
    const { memberId, walletId } = await createMember();
    await request(app).post(`/wallets/${walletId}/wagers`).send({ amount: '1' }).expect(422);
    const response = await request(app).post('/withdrawals').send({ memberId, amount: '1' }).expect(422);
    expect(response.body.error).toBe('insufficient_balance');
    expect(await FundingTransaction.count()).toBe(0);
    expect(await WalletTx.count()).toBe(0);
    await assertWallet(walletId, '0');
  });

  it('preserves all 18 fractional digits and values above JS safe integer range', async () => {
    const { memberId, walletId } = await createMember();
    await fund(memberId, '9007199254740993.123456789123456789');
    await request(app).post(`/wallets/${walletId}/wagers`).send({ amount: '0.000000000000000001' }).expect(201);
    await request(app).post('/withdrawals').send({ memberId, amount: '9007199254740993' }).expect(201);
    await assertWallet(walletId, '0.123456789123456788', '0', '0.000000000000000001');
  });

  it('rolls back every write if withdrawal ledger insert fails', async () => {
    const { memberId, walletId } = await createMember();
    const initial = await fund(memberId, '10');
    const pending = await request(app).post('/deposits').send({ memberId, amount: '5', turnoverMultiplier: 2 }).expect(201);
    const failure = new Error('ledger unavailable');
    const log = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.spyOn(ledgerRepository, 'append').mockRejectedValueOnce(failure);
    await request(app).post('/withdrawals').send({ memberId, amount: '5' }).expect(500);
    expect(log).toHaveBeenCalledWith(failure);
    expect((await FundingTransaction.findByPk(initial.body.id))!.status).toBe('Completed');
    expect((await FundingTransaction.findByPk(pending.body.id))!.status).toBe('Pending');
    expect(await FundingTransaction.count()).toBe(2);
    expect(await WalletTx.count()).toBe(1);
    await assertWallet(walletId, '10');
  });
});
