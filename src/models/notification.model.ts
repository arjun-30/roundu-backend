// EXISTING — create, findByUserId, markRead
// Owner: Dev 2 — Subscriptions + Notifications
import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../config/database';

export type NotificationType =
  | 'booking_confirmed'
  | 'booking_cancelled'
  | 'booking_reminder_24h'
  | 'booking_reminder_1h'
  | 'provider_en_route'
  | 'provider_arrived'
  | 'service_completed'
  | 'payment_received'
  | 'subscription_activated'
  | 'subscription_expiring'
  | 'subscription_expired'
  | 'subscription_renewed'
  | 'wallet_credited'
  | 'wallet_debited'
  | 'kyc_approved'
  | 'kyc_rejected'
  | 'admin_broadcast';

interface NotificationAttributes {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  data: Record<string, unknown>;
  isRead: boolean;
  readAt: Date | null;
  createdAt: Date;
}

type NotificationCreationAttributes = Optional
  NotificationAttributes,
  'id' | 'data' | 'isRead' | 'readAt' | 'createdAt'
>;

export class Notification
  extends Model<NotificationAttributes, NotificationCreationAttributes>
  implements NotificationAttributes {
  declare id: string;
  declare userId: string;
  declare type: NotificationType;
  declare title: string;
  declare body: string;
  declare data: Record<string, unknown>;
  declare isRead: boolean;
  declare readAt: Date | null;
  declare createdAt: Date;
}

Notification.init(
  {
    id:        { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    userId:    { type: DataTypes.UUID, allowNull: false },
    type:      { type: DataTypes.STRING(60), allowNull: false },
    title:     { type: DataTypes.STRING(200), allowNull: false },
    body:      { type: DataTypes.TEXT, allowNull: false },
    data:      { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    isRead:    { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    readAt:    { type: DataTypes.DATE, allowNull: true },
    createdAt: { type: DataTypes.DATE },
  },
  { sequelize, tableName: 'notifications', underscored: true, updatedAt: false }
);
