// DEV 2 — findAll, findById, create(admin), update(admin)
// Owner: Dev 2 — Subscriptions + Notifications
import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../config/database';

interface SubscriptionPlanAttributes {
  id: string;
  name: string;
  description: string | null;
  price: number;
  currency: string;
  interval: 'monthly' | 'yearly';
  features: string[];
  isActive: boolean;
  stripePriceId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

type SubscriptionPlanCreationAttributes = Optional
  SubscriptionPlanAttributes,
  'id' | 'description' | 'isActive' | 'stripePriceId' | 'createdAt' | 'updatedAt'
>;

export class SubscriptionPlan
  extends Model<SubscriptionPlanAttributes, SubscriptionPlanCreationAttributes>
  implements SubscriptionPlanAttributes {
  declare id: string;
  declare name: string;
  declare description: string | null;
  declare price: number;
  declare currency: string;
  declare interval: 'monthly' | 'yearly';
  declare features: string[];
  declare isActive: boolean;
  declare stripePriceId: string | null;
  declare createdAt: Date;
  declare updatedAt: Date;
}

SubscriptionPlan.init(
  {
    id:            { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    name:          { type: DataTypes.STRING(100), allowNull: false },
    description:   { type: DataTypes.TEXT, allowNull: true },
    price:         { type: DataTypes.DECIMAL(10, 2), allowNull: false },
    currency:      { type: DataTypes.STRING(3), allowNull: false, defaultValue: 'INR' },
    interval:      { type: DataTypes.ENUM('monthly', 'yearly'), allowNull: false },
    features:      { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    isActive:      { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    stripePriceId: { type: DataTypes.STRING(100), allowNull: true },
    createdAt:     { type: DataTypes.DATE },
    updatedAt:     { type: DataTypes.DATE },
  },
  { sequelize, tableName: 'subscription_plans', underscored: true }
);
