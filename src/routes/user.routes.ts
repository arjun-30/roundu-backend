// Owner: Tech Lead (route integration)
// Routes: /api/users/*
// All routes require Bearer auth — authenticate runs before every handler.

import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validate';
import {
  getMe,
  updateMe,
  deleteMe,
  getPreferences,
  setPreferences,
} from '../controllers/user.controller';
import {
  updateUserSchema,
  updatePreferencesSchema,
} from '../validators/user.validator';

const router = Router();

// Apply authenticate to all /users routes
router.use(authenticate);

/**
 * @route  GET /api/users/me
 * @access bearer
 * @desc   Get authenticated user's profile
 */
router.get('/me', getMe);

/**
 * @route  PATCH /api/users/me
 * @access bearer
 * @desc   Update name, email, or avatar
 */
router.patch('/me', validate(updateUserSchema), updateMe);

/**
 * @route  DELETE /api/users/me
 * @access bearer
 * @desc   Soft-delete account
 */
router.delete('/me', deleteMe);

/**
 * @route  GET /api/users/me/preferences
 * @access bearer
 * @desc   Get notification + language preferences
 */
router.get('/me/preferences', getPreferences);

/**
 * @route  PUT /api/users/me/preferences
 * @access bearer
 * @desc   Update preferences
 */
router.put('/me/preferences', validate(updatePreferencesSchema), setPreferences);

export default router;
