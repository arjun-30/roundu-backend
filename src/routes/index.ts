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
app.use('/api/v1/bookings', bookingRoutes);

const router = Router();

// Dev 1 Modules
router.use('/services', serviceRoutes);
router.use('/providers', providerRoutes);
router.use('/offers', offerRoutes);

// Dev 2 Modules
router.use('/kyc', kycRoutes);
router.use('/ratings', ratingRoutes);
router.use('/reports', reportRoutes);

// Shared/User Modules
router.use('/auth', authRoutes);
router.use('/preferences', preferenceRoutes);

export default router;
