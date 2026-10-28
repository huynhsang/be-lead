'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      const options = { transaction };
      await queryInterface.addColumn('wallets', 'required_turnover', {
        type: Sequelize.DECIMAL(36, 18), allowNull: false, defaultValue: '0',
      }, options);
      await queryInterface.addColumn('wallets', 'accrued_turnover', {
        type: Sequelize.DECIMAL(36, 18), allowNull: false, defaultValue: '0',
      }, options);

      await queryInterface.createTable('funding_transactions', {
        id: {
          type: Sequelize.UUID, primaryKey: true, defaultValue: Sequelize.literal('gen_random_uuid()'),
        },
        wallet_id: {
          type: Sequelize.UUID, allowNull: false, references: { model: 'wallets', key: 'id' },
        },
        type: { type: Sequelize.STRING, allowNull: false },
        status: { type: Sequelize.STRING, allowNull: false, defaultValue: 'Pending' },
        amount: { type: Sequelize.DECIMAL(36, 18), allowNull: false },
        psp_ref: { type: Sequelize.STRING, allowNull: true, unique: true },
        turnover_multiplier: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
        created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('now()') },
        updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('now()') },
      }, options);
      await queryInterface.addIndex('funding_transactions', ['wallet_id'], options);

      await queryInterface.createTable('wallet_txs', {
        id: {
          type: Sequelize.UUID, primaryKey: true, defaultValue: Sequelize.literal('gen_random_uuid()'),
        },
        wallet_id: {
          type: Sequelize.UUID, allowNull: false, references: { model: 'wallets', key: 'id' },
        },
        funding_transaction_id: {
          type: Sequelize.UUID, allowNull: true, unique: true,
          references: { model: 'funding_transactions', key: 'id' },
        },
        kind: { type: Sequelize.STRING, allowNull: false },
        amount: { type: Sequelize.DECIMAL(36, 18), allowNull: false },
        balance_after: { type: Sequelize.DECIMAL(36, 18), allowNull: false },
        created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('now()') },
      }, options);
      await queryInterface.addIndex('wallet_txs', ['wallet_id', 'created_at'], options);

      await queryInterface.sequelize.query(`
        ALTER TABLE wallets ADD CONSTRAINT wallets_nonnegative
          CHECK (balance >= 0 AND required_turnover >= 0 AND accrued_turnover >= 0);
        ALTER TABLE funding_transactions ADD CONSTRAINT funding_valid
          CHECK (
            amount > 0 AND turnover_multiplier >= 0
            AND status IN ('Pending', 'Completed', 'Failed')
            AND (
              (type = 'Deposit' AND psp_ref IS NOT NULL)
              OR (type = 'Withdrawal' AND psp_ref IS NULL AND turnover_multiplier = 0)
            )
          );
        ALTER TABLE wallet_txs ADD CONSTRAINT wallet_txs_valid
          CHECK (
            balance_after >= 0
            AND (
              (kind = 'Opening' AND amount > 0 AND funding_transaction_id IS NULL)
              OR (kind = 'Deposit' AND amount > 0 AND funding_transaction_id IS NOT NULL)
              OR (kind = 'Wager' AND amount < 0 AND funding_transaction_id IS NULL)
              OR (kind = 'Withdrawal' AND amount < 0 AND funding_transaction_id IS NOT NULL)
            )
          );
        INSERT INTO wallet_txs (wallet_id, kind, amount, balance_after)
          SELECT id, 'Opening', balance, balance FROM wallets WHERE balance > 0;
        CREATE FUNCTION reject_wallet_tx_mutation() RETURNS trigger AS $$
        BEGIN
          RAISE EXCEPTION 'wallet_txs is append-only';
        END;
        $$ LANGUAGE plpgsql;
        CREATE TRIGGER wallet_txs_append_only
          BEFORE UPDATE OR DELETE ON wallet_txs
          FOR EACH ROW EXECUTE FUNCTION reject_wallet_tx_mutation();
      `, options);
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      const options = { transaction };
      await queryInterface.dropTable('wallet_txs', options);
      await queryInterface.sequelize.query('DROP FUNCTION reject_wallet_tx_mutation()', options);
      await queryInterface.dropTable('funding_transactions', options);
      await queryInterface.sequelize.query(
        'ALTER TABLE wallets DROP CONSTRAINT wallets_nonnegative', options,
      );
      await queryInterface.removeColumn('wallets', 'accrued_turnover', options);
      await queryInterface.removeColumn('wallets', 'required_turnover', options);
    });
  },
};
