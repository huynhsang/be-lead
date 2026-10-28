import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { FundingTransaction, WalletTx } from '../src/db/models';
import { dec, money } from '../src/lib/money';
import {
  app, assertWallet, createMember, registerDbLifecycle,
} from './support/moneyFlowHarness';

registerDbLifecycle();

describe('deposits', () => {
  it('creates a pending deposit with default multiplier without moving money', async () => {
    const { memberId, walletId } = await createMember();
    const response = await request(app).post('/deposits').send({ memberId, amount: '100.50' }).expect(201);
    expect(response.body).toMatchObject({
      id: expect.any(String), pspRef: expect.any(String), type: 'Deposit',
      status: 'Pending', turnoverMultiplier: 1, amount: money(dec('100.50')),
    });
    expect(await FundingTransaction.count()).toBe(1);
    expect(await WalletTx.count()).toBe(0);
    await assertWallet(walletId, '0');
  });

  it.each([-1, 1.5, '1', 2147483648, null])('rejects invalid multiplier %p', async (turnoverMultiplier) => {
    await request(app).post('/deposits').send({ memberId: randomUUID(), amount: '1', turnoverMultiplier }).expect(400);
  });

  it.each([
    '0', '-1', '1e2', 'NaN', 'Infinity', '', ' 1', '01', '0.0000000000000000001',
    '1000000000000000000', 1, null,
  ])('rejects invalid deposit amounts %p', async (amount) => {
    await request(app).post('/deposits').send({ memberId: randomUUID(), amount }).expect(400);
    expect(await FundingTransaction.count()).toBe(0);
    expect(await WalletTx.count()).toBe(0);
  });

  it('returns explicit validation and not-found errors for member identifiers', async () => {
    await request(app).post('/deposits').send({ memberId: 'bad', amount: '1' }).expect(400);
    await request(app).post('/deposits').send({ memberId: randomUUID(), amount: '1' }).expect(404);
  });

  it('returns 400 for malformed JSON payloads', async () => {
    await request(app).post('/deposits').set('Content-Type', 'application/json').send('{"amount":').expect(400);
  });

  it('rejects turnover product overflow before creating a deposit', async () => {
    const { memberId, walletId } = await createMember();
    const response = await request(app).post('/deposits')
      .send({ memberId, amount: '999999999999999999', turnoverMultiplier: 2 }).expect(422);
    expect(response.body.error).toBe('money_limit_exceeded');
    expect(await FundingTransaction.count()).toBe(0);
    await assertWallet(walletId, '0');
  });
});
