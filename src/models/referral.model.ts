// Owner: Dev 4 — Referrals + Offers + Portfolio + Tracking
// Model: referral.model.ts
// Mirrors migration: 014_referrals.sql

export interface Referral {
  id: string;
  referrerId: string;       // user who owns the code
  referredId: string;       // user who applied the code
  code: string;
  rewardAmount: number;
  currency: string;
  status: ReferralStatus;
  createdAt: Date;
  settledAt?: Date;
}

export type ReferralStatus = 'pending' | 'settled' | 'expired';

export interface ReferralCode {
  userId: string;
  code: string;             // e.g. ARJUN30
  shareUrl: string;
  totalEarned: number;
  totalReferrals: number;
}

export interface ReferralEvent {
  id: string;
  referredName: string;
  rewardAmount: number;
  currency: string;
  status: ReferralStatus;
  createdAt: Date;
}