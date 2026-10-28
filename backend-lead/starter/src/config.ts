import 'dotenv/config';

const env = process.env.NODE_ENV ?? 'development';

/**
 * Process configuration loaded from the environment after dotenv initialization.
 *
 * @remarks Only NODE_ENV equal to `test` selects DATABASE_URL_TEST; all other
 * environments use DATABASE_URL. Missing values use the local development defaults.
 */
export const config = {
  env,
  port: Number(process.env.PORT ?? 3000),
  databaseUrl:
    env === 'test'
      ? process.env.DATABASE_URL_TEST ?? 'postgres://wallet:wallet@localhost:5439/wallet_test'
      : process.env.DATABASE_URL ?? 'postgres://wallet:wallet@localhost:5439/wallet',
};
