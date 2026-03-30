// DEV 3
// src/routes/recommendation.routes.ts
// Owner: Dev 3 (GPS + AI)
//
// Mounts at: /api/recommendations
//
// GET  /api/recommendations           bearer → personalized recommendations
// POST /api/recommendations/feedback  bearer → record user feedback

import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import {
  getRecommendations,
  submitFeedback,
} from '../controllers/recommendation.controller';

const router = Router();

// Both endpoints require any authenticated user (customer)
router.get('/', authenticate, getRecommendations);
router.post('/feedback', authenticate, submitFeedback);

export default router;
