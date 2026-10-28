import { createApp } from './app';
import { config } from './config';
import { sequelize } from './db/sequelize';

/** Authenticates the database before opening the HTTP listener; startup failures exit below. */
async function main() {
  await sequelize.authenticate();
  const app = createApp();
  app.listen(config.port, () => {
    // eslint-disable-next-line no-console
    console.log(`mini-wallet-service listening on :${config.port}`);
  });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
