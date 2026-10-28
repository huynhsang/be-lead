import { Sequelize } from 'sequelize';
import { config } from '../config';

/**
 * Shared PostgreSQL connection pool for application queries and managed transactions.
 *
 * @remarks Construction does not verify connectivity or apply migrations. Database
 * identifiers use snake_case; model attributes remain camelCase.
 */
export const sequelize = new Sequelize(config.databaseUrl, {
  dialect: 'postgres',
  logging: false,
  define: { underscored: true },
});
