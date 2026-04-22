// DEV 4
import { Router } from 'express';
import { getMyPreferences, updateMyPreferences } from '../controllers/preference.controller';
import { validate } from '../middleware/validate';
import { updatePreferenceSchema } from '../validators/preference.validator';

const router = Router();

router.get('/', getMyPreferences);
router.put('/', validate(updatePreferenceSchema), updateMyPreferences);

export default router;
