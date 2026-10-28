import { DataTypes, Model, Sequelize } from 'sequelize';

/** Persisted member identity with a unique username and one associated wallet. */
export class Member extends Model {
  declare id: string;
  declare username: string;
}

/** Registers the members table mapping on a connection; schema changes require migrations. */
export function initMember(sequelize: Sequelize): void {
  Member.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      username: { type: DataTypes.STRING, allowNull: false, unique: true },
    },
    { sequelize, tableName: 'members', underscored: true },
  );
}
