import { Router } from 'express';
import { auth } from '../middleware/auth';
import { requireRole } from '../middleware/requireRole';
import { validate } from '../middleware/validate';
import { approveProviderSchema, reviewDocumentSchema, updateSettingSchema, banUserSchema } from '../validators/admin.validator';
import * as ctrl from '../controllers/admin.controller';

const router = Router();

// All routes require auth + admin role
router.use(auth, requireRole('admin'));

// Dashboard
router.get('/dashboard', ctrl.dashboard);

// User management
router.get('/users', ctrl.listUsers);
router.patch('/users/:id/ban', validate(banUserSchema), ctrl.banUser);

// Provider management
router.get('/providers', ctrl.listProviders);
router.patch('/providers/:id/approve', validate(approveProviderSchema), ctrl.approveProvider);

// Document review
router.patch('/documents/:id/review', validate(reviewDocumentSchema), ctrl.reviewDocument);

// Platform settings
router.get('/settings', ctrl.getSettings);
router.put('/settings/:key', validate(updateSettingSchema), ctrl.updateSetting);

// Reports
router.get('/reports/revenue', ctrl.revenueReport);

export default router;
