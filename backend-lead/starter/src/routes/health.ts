import { Router } from 'express';
import { sequelize } from '../db/sequelize';

/** GET `/health`: checks database connectivity before returning `{ status: 'ok' }`. */
export const healthRouter = Router();

healthRouter.get('/', async (_req, res) => {
  await sequelize.authenticate();
  res.json({ status: 'ok' });
});
