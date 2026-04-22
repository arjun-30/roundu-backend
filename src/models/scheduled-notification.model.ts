// DEV 2 — create, findPending, markSent, findByBookingId
// Owner: Dev 2 — Subscriptions + Notifications
import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../config/database';

export type ScheduledNotificationStatus = 'pending' | 'sent' | 'failed' | 'cancelled';

interface ScheduledNotificationAttributes {
  id: string;
  userId: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  scheduledAt: Date;
  sentAt: Date | null;
  status: ScheduledNotificationStatus;
  createdBy: string | null;
  createdAt: Date;
}

type ScheduledNotificationCreationAttributes = Optional
  ScheduledNotificationAttributes,
  'id' | 'data' | 'sentAt' | 'status' | 'createdBy' | 'createdAt'
>;

export class ScheduledNotification
  extends Model<ScheduledNotificationAttributes, ScheduledNotificationCreationAttributes>
  implements ScheduledNotificationAttributes {
  declare id: string;
  declare userId: string;
  declare title: string;
  declare body: string;
  declare data: Record<string, unknown>;
  declare scheduledAt: Date;
  declare sentAt: Date | null;
  declare status: ScheduledNotificationStatus;
  declare createdBy: string | null;
  declare createdAt: Date;
}

ScheduledNotification.init(
  {
    id:          { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    userId:      { type: DataTypes.UUID, allowNull: false },
    title:       { type: DataTypes.STRING(200), allowNull: false },
    body:        { type: DataTypes.TEXT, allowNull: false },
    data:        { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    scheduledAt: { type: DataTypes.DATE, allowNull: false },
    sentAt:      { type: DataTypes.DATE, allowNull: true },
    status:      { type: DataTypes.ENUM('pending','sent','failed','cancelled'), allowNull: false, defaultValue: 'pending' },
    createdBy:   { type: DataTypes.UUID, allowNull: true },
    createdAt:   { type: DataTypes.DATE },
  },
  { sequelize, tableName: 'scheduled_notifications', underscored: true, updatedAt: false }
);
