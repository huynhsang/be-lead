import { Router } from 'express';
import { z } from 'zod';
import { recordWager } from '../services/walletService';
import { amountSchema, idSchema } from './schemas';

/**
 * POST `/wallets/:walletId/wagers`: records a validated debit and returns its result (201).
 *
 * @remarks The service serializes debits on the wallet; each accepted request
 * accrues turnover and produces a distinct ledger entry.
 */
export const walletsRouter = Router();
const wagerBody = z.object({ amount: amountSchema });

walletsRouter.post('/:walletId/wagers', async (req, res, next) => {
  try {
    const walletId = idSchema.parse(req.params.walletId);
    const body = wagerBody.parse(req.body);
    res.status(201).json(await recordWager(walletId, body.amount));
  } catch (err) {
    next(err);
  }
});
