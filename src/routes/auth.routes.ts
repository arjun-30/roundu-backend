// src/routes/auth.routes.ts
// Owner: Lead

import { Router } from "express";
import { authenticate } from "../middleware/auth";
import { validate } from "../middleware/validate";
import {
  register,
  login,
  verifyOtp,
  refresh,
  logout,
} from "../controllers/auth.controller";
import {
  registerSchema,
  loginSchema,
  verifyOtpSchema,
  refreshSchema,
  logoutSchema,
} from "../validators/auth.validator";

const router = Router();

router.post("/register",    validate(registerSchema),   register);
router.post("/login",       validate(loginSchema),      login);
router.post("/verify-otp",  validate(verifyOtpSchema),  verifyOtp);
router.post("/refresh",     validate(refreshSchema),    refresh);
router.post("/logout",      authenticate,               validate(logoutSchema), logout);

export default router;