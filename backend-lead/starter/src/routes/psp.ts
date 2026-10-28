import { Router } from 'express';
import { z } from 'zod';
import { handleCallback } from '../services/depositService';
import { amountSchema } from './schemas';

/**
 * POST `/psp/callbacks`: validates a mock terminal event and returns funding (200).
 *
 * @remarks Matching retries are acknowledged without a second credit. This mock
 * endpoint performs no provider authentication or signature verification.
 */
export const pspRouter = Router();

const callbackBody = z.object({
  pspRef: z.string().min(1).max(255),
  status: z.enum(['completed', 'failed']),
  amount: amountSchema,
});

pspRouter.post('/callbacks', async (req, res, next) => {
  try {
    const body = callbackBody.parse(req.body);
    res.json(await handleCallback(body.pspRef, body.status, body.amount));
  } catch (err) {
    next(err);
  }
});
