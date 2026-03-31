// DEV 2 — create, findByBookingId, updateStatus
// Owner: Dev 4 — Real-time & Communications
// Purpose: Sequelize model for call_logs table — records every ElevenLabs auto-call attempt

import {
  Model,
  DataTypes,
  InferAttributes,
  InferCreationAttributes,
  CreationOptional,
  ForeignKey,
} from 'sequelize';
import { sequelize } from '../config/database';

export type CallDirection = 'outbound_provider' | 'outbound_user';
export type CallStatus = 'initiated' | 'answered' | 'no_answer' | 'failed' | 'completed';
export type CallOutcome = 'accepted' | 'rejected' | 'no_response' | 'error';

export class CallLog extends Model<
  InferAttributes<CallLog>,
  InferCreationAttributes<CallLog>
> {
  declare id: CreationOptional<string>;

  // Relations
  declare bookingId: ForeignKey<string>;
  declare callerId: ForeignKey<string>;   // user or provider who is "called" (recipient)
  declare agentId: string;                // ElevenLabs agent ID used

  // Call metadata
  declare direction: CallDirection;
  declare phoneNumber: string;            // E.164 format
  declare conversationId: CreationOptional<string | null>; // ElevenLabs conversation ID

  // Status tracking
  declare status: CallStatus;
  declare outcome: CreationOptional<CallOutcome | null>;
  declare durationSeconds: CreationOptional<number | null>;
  declare attemptNumber: CreationOptional<number>;  // 1-indexed retry count

  // Timestamps
  declare initiatedAt: CreationOptional<Date>;
  declare answeredAt: CreationOptional<Date | null>;
  declare endedAt: CreationOptional<Date | null>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

CallLog.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    bookingId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: 'bookings', key: 'id' },
      onDelete: 'CASCADE',
    },
    callerId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: 'users', key: 'id' },
    },
    agentId: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    direction: {
      type: DataTypes.ENUM('outbound_provider', 'outbound_user'),
      allowNull: false,
    },
    phoneNumber: {
      type: DataTypes.STRING(20),
      allowNull: false,
    },
    conversationId: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    status: {
      type: DataTypes.ENUM('initiated', 'answered', 'no_answer', 'failed', 'completed'),
      allowNull: false,
      defaultValue: 'initiated',
    },
    outcome: {
      type: DataTypes.ENUM('accepted', 'rejected', 'no_response', 'error'),
      allowNull: true,
    },
    durationSeconds: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    attemptNumber: {
      type: DataTypes.SMALLINT,
      allowNull: false,
      defaultValue: 1,
    },
    initiatedAt: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    },
    answeredAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    endedAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  {
    sequelize,
    tableName: 'call_logs',
    timestamps: true,
    indexes: [
      { fields: ['bookingId'] },
      { fields: ['callerId'] },
      { fields: ['status'] },
      { fields: ['createdAt'] },
    ],
  },
);

export default CallLog;
