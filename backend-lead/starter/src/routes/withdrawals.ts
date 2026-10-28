import { Router } from 'express';
import { createWithdrawal } from '../services/walletService';
import { memberAmountBody } from './schemas';

/**
 * POST `/withdrawals`: validates member and amount, then returns pending funding (201).
 *
 * @remarks Accepted withdrawals debit immediately. Outstanding turnover produces
 * a 422 response including the exact outstanding amount as a decimal string.
 */
export const withdrawalsRouter = Router();

withdrawalsRouter.post('/', async (req, res, next) => {
  try {
    const body = memberAmountBody.parse(req.body);
    res.status(201).json(await createWithdrawal(body.memberId, body.amount));
  } catch (err) {
    next(err);
  }
});
