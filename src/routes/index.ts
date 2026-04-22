import { Router } from 'express';
import authRoutes from './auth.routes';
import serviceRoutes from './service.routes';
import providerRoutes from './provider.routes';
import kycRoutes from './kyc.routes';
import ratingRoutes from './rating.routes';
import reportRoutes from './service-report.routes';
import offerRoutes from './offer.routes';
import preferenceRoutes from './preference.routes';
import bookingRoutes from './booking.routes';
import walletRoutes from './wallet.routes';
import paymentRoutes from './payment.routes';
import subscriptionRoutes from './subscription.routes';
import trackingRoutes from './tracking.routes';
import portfolioRoutes from './portfolio.routes';
import uploadRoutes from './upload.routes';
import userRoutes from './user.routes';
import referralRoutes from './referral.routes';
import adminRoutes from './admin.routes';
import notificationScheduleRoutes from './notification-schedule.routes';
import webhookRoutes from './webhook.routes';

const router = Router();

// Shared / auth
router.use('/auth', authRoutes);
router.use('/user', userRoutes);
router.use('/preferences', preferenceRoutes);

// Dev 1 — services, providers, offers, bookings, payments, wallet
router.use('/services', serviceRoutes);
router.use('/providers', providerRoutes);
router.use('/offers', offerRoutes);
router.use('/bookings', bookingRoutes);
router.use('/payments', paymentRoutes);
router.use('/wallet', walletRoutes);

// Dev 2 — KYC, ratings, reports, subscriptions, notifications
router.use('/kyc', kycRoutes);
router.use('/ratings', ratingRoutes);
router.use('/reports', reportRoutes);
router.use('/subscription', subscriptionRoutes);
router.use('/notification-schedule', notificationScheduleRoutes);

// Dev 4 — referrals, portfolio, tracking, uploads
router.use('/referral', referralRoutes);
router.use('/portfolio', portfolioRoutes);
router.use('/tracking', trackingRoutes);
router.use('/upload', uploadRoutes);

// Admin + webhooks
router.use('/admin', adminRoutes);
router.use('/webhook', webhookRoutes);

export default router;
