// DEV 4
import { Router } from 'express';
import { getOffers, validateOffer } from '../controllers/offer.controller';
import { validate } from '../middleware/validate';
import { validateOfferSchema } from '../validators/offer.validator';

const router = Router();

router.get('/', getOffers);
router.post('/validate', validate(validateOfferSchema), validateOffer);

export default router;
