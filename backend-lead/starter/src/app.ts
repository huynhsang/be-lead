import express, { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import { healthRouter } from './routes/health';
import { membersRouter } from './routes/members';
import { depositsRouter } from './routes/deposits';
import { pspRouter } from './routes/psp';
import { walletsRouter } from './routes/wallets';
import { withdrawalsRouter } from './routes/withdrawals';
import { ServiceError } from './domain/errors';

/** Maps validation and business failures to JSON; logs unexpected errors before returning 500. */
const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ZodError) {
    res.status(400).json({ error: 'validation_error', details: err.issues });
    return;
  }
  if (err instanceof ServiceError) {
    res.status(err.status).json({ error: err.code, ...err.details });
    return;
  }
  if (err instanceof SyntaxError && 'type' in err && err.type === 'entity.parse.failed') {
    res.status(400).json({ error: 'invalid_json' });
    return;
  }
  // eslint-disable-next-line no-console
  console.error(err);
  res.status(500).json({ error: 'internal_error' });
};

/**
 * Creates the JSON API with routes and centralized error handling, without listening.
 *
 * @remarks Does not authenticate the database or apply migrations. Startup handles
 * connectivity separately; tests can pass the returned app directly to Supertest.
 */
export function createApp() {
  const app = express();
  app.use(express.json());

  app.use('/health', healthRouter);
  app.use('/members', membersRouter);
  app.use('/deposits', depositsRouter);
  app.use('/psp', pspRouter);
  app.use('/wallets', walletsRouter);
  app.use('/withdrawals', withdrawalsRouter);

  app.use(errorHandler);
  return app;
}
