// src/routes/booking.routes.ts
// Owner: Lead

import { Router } from "express";
import { authenticate } from "../middleware/auth";
import { requireRole }  from "../middleware/auth";
import { validate }     from "../middleware/validate";
import {
  createBookingSchema,
  updateBookingStatusSchema,
  cancelBookingSchema,
  listBookingsSchema,
} from "../validators/booking.validator";
import {
  createBookingHandler,
  listBookingsHandler,
  getBookingHandler,
  updateBookingStatusHandler,
  cancelBookingHandler,
} from "../controllers/booking.controller";

const router = Router();

// All booking routes require auth
router.use(authenticate);

router.post(
  "/",
  validate(createBookingSchema),
  createBookingHandler
);

router.get(
  "/",
  validate(listBookingsSchema),
  listBookingsHandler
);

router.get(
  "/:id",
  getBookingHandler
);

router.patch(
  "/:id/status",
  requireRole("provider"),
  validate(updateBookingStatusSchema),
  updateBookingStatusHandler
);

router.post(
  "/:id/cancel",
  validate(cancelBookingSchema),
  cancelBookingHandler
);

export default router;