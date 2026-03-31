// EXISTING
import { Router } from 'express';
import { getProviders, getProviderById, updateMyProviderProfile } from '../controllers/provider.controller';
import { requireProvider } from '../middleware/requireProvider'; // The one we wrote earlier!
import { validate } from '../middleware/validate';
import { updateProviderSchema } from '../validators/provider.validator';

const router = Router();

router.get('/', getProviders);
router.get('/:id', getProviderById);
router.patch('/me', requireProvider, validate(updateProviderSchema), updateMyProviderProfile);

export default router;
