import { sequelize } from '../sequelize';
import { Member, initMember } from './member';
import { Wallet, initWallet } from './wallet';
import { FundingTransaction, initFundingTransaction } from './fundingTransaction';
import { WalletTx, initWalletTx } from './walletTx';

// Importing this module initializes all models and associations on the shared connection.
initMember(sequelize);
initWallet(sequelize);
initFundingTransaction(sequelize);
initWalletTx(sequelize);

Member.hasOne(Wallet, { foreignKey: 'memberId', as: 'wallet' });
Wallet.belongsTo(Member, { foreignKey: 'memberId', as: 'member' });
Wallet.hasMany(FundingTransaction, { foreignKey: 'walletId', as: 'fundingTransactions' });
FundingTransaction.belongsTo(Wallet, { foreignKey: 'walletId', as: 'wallet' });
Wallet.hasMany(WalletTx, { foreignKey: 'walletId', as: 'ledger' });
WalletTx.belongsTo(Wallet, { foreignKey: 'walletId', as: 'wallet' });
WalletTx.belongsTo(FundingTransaction, { foreignKey: 'fundingTransactionId', as: 'fundingTransaction' });

/** Initialized models for the shared connection; database tables are managed by migrations. */
export { Member, Wallet, FundingTransaction, WalletTx };
