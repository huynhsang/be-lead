import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { WalletTx } from '../src/db/models';
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

describe('wagers', () => {
  it('prevents concurrent wagers from overdrawing and accrues only the accepted wager', async () => {
    const { memberId, walletId } = await createMember();
    await fund(memberId, '10');
    const results = await contended(walletId, [
      () => request(app).post(`/wallets/${walletId}/wagers`).send({ amount: '7' }),
      () => request(app).post(`/wallets/${walletId}/wagers`).send({ amount: '7' }),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([201, 422]);
    expect(results.find((result) => result.status === 422)!.body.error).toBe('insufficient_balance');
    expect(await WalletTx.count({ where: { kind: 'Wager' } })).toBe(1);
    await assertWallet(walletId, '3', '0', '7');
  });

  it('allows both concurrent wagers when funded and loses neither debit', async () => {
    const { memberId, walletId } = await createMember();
    await fund(memberId, '10');
    const results = await contended(walletId, [
      () => request(app).post(`/wallets/${walletId}/wagers`).send({ amount: '4' }),
      () => request(app).post(`/wallets/${walletId}/wagers`).send({ amount: '4' }),
    ]);
    expect(results.map((result) => result.status)).toEqual([201, 201]);
    await assertWallet(walletId, '2', '0', '8');
  });

  it('rejects invalid and unknown wallet identifiers', async () => {
    await request(app).post('/wallets/bad/wagers').send({ amount: '1' }).expect(400);
    await request(app).post(`/wallets/${randomUUID()}/wagers`).send({ amount: '1' }).expect(404);
  });

  it('rejects invalid wager amounts', async () => {
    const { walletId } = await createMember();
    await request(app).post(`/wallets/${walletId}/wagers`).send({ amount: '0' }).expect(400);
    await request(app).post(`/wallets/${walletId}/wagers`).send({ amount: '1e2' }).expect(400);
    await request(app).post(`/wallets/${walletId}/wagers`).send({ amount: '01' }).expect(400);
  });

  it('rolls back a wager if lifetime accrued turnover would overflow', async () => {
    const { memberId, walletId } = await createMember();
    const maximum = '999999999999999999.999999999999999999';
    await fund(memberId, maximum);
    await request(app).post(`/wallets/${walletId}/wagers`).send({ amount: maximum }).expect(201);
    await fund(memberId, '1');
    const response = await request(app).post(`/wallets/${walletId}/wagers`).send({ amount: '1' }).expect(422);
    expect(response.body.error).toBe('money_limit_exceeded');
    expect(await WalletTx.count({ where: { kind: 'Wager' } })).toBe(1);
    await assertWallet(walletId, '1', '0', maximum);
  });

  it('rolls back every write if wager ledger insert fails', async () => {
    const { memberId, walletId } = await createMember();
    await fund(memberId, '10');
    const pending = await deposit(memberId, '5', 2);
    const failure = new Error('ledger unavailable');
    const log = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.spyOn(ledgerRepository, 'append').mockRejectedValueOnce(failure);
    await request(app).post(`/wallets/${walletId}/wagers`).send({ amount: '5' }).expect(500);
    expect(log).toHaveBeenCalledWith(failure);
    await callback(pending.body.pspRef, '5').expect(200);
    expect(await WalletTx.count()).toBe(2);
    await assertWallet(walletId, '15', '10');
  });
});
