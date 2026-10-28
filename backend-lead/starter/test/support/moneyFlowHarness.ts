import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { QueryTypes } from 'sequelize';
import request, { Response } from 'supertest';
import { createApp } from '../../src/app';
import { FundingTransaction, Wallet, WalletTx } from '../../src/db/models';
import { sequelize } from '../../src/db/sequelize';
import { dec, money, ZERO } from '../../src/lib/money';

export const app = createApp();

export function registerDbLifecycle() {
  beforeAll(async () => {
    await sequelize.authenticate();
  });

  beforeEach(async () => {
    await sequelize.truncate({ cascade: true });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await sequelize.close();
  });
}

export async function createMember() {
  const response = await request(app).post('/members').send({ username: `member-${randomUUID()}` }).expect(201);
  return { memberId: response.body.member.id as string, walletId: response.body.wallet.id as string };
}

export async function deposit(memberId: string, amount: string, turnoverMultiplier = 1) {
  return request(app).post('/deposits').send({ memberId, amount, turnoverMultiplier }).expect(201);
}

export function callback(pspRef: string, amount: unknown, status = 'completed') {
  return request(app).post('/psp/callbacks').send({ pspRef, amount, status });
}

export async function fund(memberId: string, amount: string, turnoverMultiplier = 0) {
  const response = await deposit(memberId, amount, turnoverMultiplier);
  await callback(response.body.pspRef, amount).expect(200);
  return response;
}

export async function assertWallet(
  walletId: string, balance: string, requiredTurnover = '0', accruedTurnover = '0',
) {
  const wallet = await Wallet.findByPk(walletId);
  expect(wallet).not.toBeNull();
  expect(wallet!.balance).toBe(money(dec(balance)));
  expect(wallet!.requiredTurnover).toBe(money(dec(requiredTurnover)));
  expect(wallet!.accruedTurnover).toBe(money(dec(accruedTurnover)));
  const ledger = await WalletTx.findAll({ where: { walletId } });
  const reconstructed = ledger.reduce((sum, entry) => sum.plus(entry.amount), ZERO);
  expect(money(reconstructed)).toBe(wallet!.balance);
  const deposits = await FundingTransaction.findAll({
    where: { walletId, type: 'Deposit', status: 'Completed' },
  });
  const required = deposits.reduce(
    (sum, entry) => sum.plus(dec(entry.amount).times(entry.turnoverMultiplier)), ZERO,
  );
  const accrued = ledger.filter((entry) => entry.kind === 'Wager')
    .reduce((sum, entry) => sum.minus(entry.amount), ZERO);
  expect(money(required)).toBe(wallet!.requiredTurnover);
  expect(money(accrued)).toBe(wallet!.accruedTurnover);
}

// Hold the wallet lock until both HTTP requests are demonstrably waiting in
// PostgreSQL. This exercises real contention, not merely Promise scheduling.
export async function contended(
  walletId: string,
  operations: Array<() => PromiseLike<Response>>,
): Promise<Response[]> {
  const blocker = await sequelize.transaction();
  let responses: Array<Promise<Response>> = [];
  try {
    await Wallet.findByPk(walletId, { transaction: blocker, lock: blocker.LOCK.UPDATE });
    responses = operations.map((operation) => Promise.resolve(operation()));
    const deadline = Date.now() + 5000;
    let waiting = 0;
    while (Date.now() < deadline) {
      const [result] = await sequelize.query<{ count: number }>(`
        SELECT COUNT(*)::integer AS count
        FROM pg_stat_activity
        WHERE datname = current_database() AND pid <> pg_backend_pid()
          AND state = 'active' AND wait_event_type = 'Lock'
          AND query LIKE '%FOR UPDATE%'
      `, { type: QueryTypes.SELECT });
      waiting = result.count;
      if (waiting >= operations.length) break;
      await delay(10);
    }
    expect(waiting).toBeGreaterThanOrEqual(operations.length);
  } finally {
    await blocker.rollback();
    await Promise.all(responses);
  }
  return Promise.all(responses);
}
