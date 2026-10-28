import { Router } from 'express';
import { z } from 'zod';
import { createDeposit } from '../services/depositService';
import { memberAmountBody } from './schemas';

/**
 * POST `/deposits`: validates member and amount, then returns pending funding (201).
 *
 * @remarks The nonnegative integer turnover multiplier defaults to 1. Creating a
 * deposit moves no money; the generated PSP reference is used for later callbacks.
 */
export const depositsRouter = Router();

const depositBody = memberAmountBody.extend({
  turnoverMultiplier: z.number().int().min(0).max(2147483647).default(1),
});

depositsRouter.post('/', async (req, res, next) => {
  try {
    const body = depositBody.parse(req.body);
    res.status(201).json(await createDeposit(body.memberId, body.amount, body.turnoverMultiplier));
  } catch (err) {
    next(err);
  }
});
