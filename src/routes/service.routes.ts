// EXISTING
import { Router } from 'express';
import { getServices, getServiceById, createService, updateService, deleteService } from '../controllers/service.controller';
import { requireRole } from '../middleware/requireRole'; // Assuming Admin check exists
import { validate } from '../middleware/validate';
import { createServiceSchema, updateServiceSchema } from '../validators/service.validator';

const router = Router();

// Public routes
router.get('/', getServices);
router.get('/:id', getServiceById);

// Admin only routes
router.post('/', requireRole('admin'), validate(createServiceSchema), createService);
router.put('/:id', requireRole('admin'), validate(updateServiceSchema), updateService);
router.delete('/:id', requireRole('admin'), deleteService);

export default router;
