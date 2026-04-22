// DEV 2 — create, findByUserId, findById, updateStatus, findDueForScheduling
// Owner: Dev 2 — Subscriptions + Notifications
import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../config/database';
import { SubscriptionPlan } from './subscription-plan.model';

export type SubscriptionStatus = 'active' | 'cancelled' | 'expired' | 'past_due';

interface SubscriptionAttributes {
  id: string;
  userId: string;
  planId: string;
  status: SubscriptionStatus;
  stripeSubscriptionId: string | null;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  cancelAtPeriodEnd: boolean;
  cancelledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

type SubscriptionCreationAttributes = Optional
  SubscriptionAttributes,
  'id' | 'stripeSubscriptionId' | 'cancelAtPeriodEnd' | 'cancelledAt' | 'createdAt' | 'updatedAt'
>;

export class Subscription
  extends Model<SubscriptionAttributes, SubscriptionCreationAttributes>
  implements SubscriptionAttributes {
  declare id: string;
  declare userId: string;
  declare planId: string;
  declare status: SubscriptionStatus;
  declare stripeSubscriptionId: string | null;
  declare currentPeriodStart: Date;
  declare currentPeriodEnd: Date;
  declare cancelAtPeriodEnd: boolean;
  declare cancelledAt: Date | null;
  declare createdAt: Date;
  declare updatedAt: Date;

  declare plan?: SubscriptionPlan;
}

Subscription.init(
  {
    id:                   { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    userId:               { type: DataTypes.UUID, allowNull: false },
    planId:               { type: DataTypes.UUID, allowNull: false },
    status:               { type: DataTypes.ENUM('active','cancelled','expired','past_due'), allowNull: false, defaultValue: 'active' },
    stripeSubscriptionId: { type: DataTypes.STRING(100), allowNull: true, unique: true },
    currentPeriodStart:   { type: DataTypes.DATE, allowNull: false },
    currentPeriodEnd:     { type: DataTypes.DATE, allowNull: false },
    cancelAtPeriodEnd:    { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    cancelledAt:          { type: DataTypes.DATE, allowNull: true },
    createdAt:            { type: DataTypes.DATE },
    updatedAt:            { type: DataTypes.DATE },
  },
  { sequelize, tableName: 'subscriptions', underscored: true }
);

Subscription.belongsTo(SubscriptionPlan, { foreignKey: 'planId', as: 'plan' });
