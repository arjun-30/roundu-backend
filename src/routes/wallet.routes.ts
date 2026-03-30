// DEV 1 — Wallet routes

import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/requireRole';
import { validate } from '../middleware/validate';
import { withdrawSchema } from '../validators/wallet.validator';
import { getWallet, getTransactions, withdraw } from '../controllers/wallet.controller';

const router = Router();

// All wallet routes require authentication
router.use(authenticate);

/**
 * GET /api/wallet
 * Get current wallet balance.
 */
router.get('/', getWallet);

/**
 * GET /api/wallet/transactions
 * Paginated transaction history. Accepts ?type=credit|debit&page=&limit=
 */
router.get('/transactions', getTransactions);

/**
 * POST /api/wallet/withdraw
 * Provider-only withdrawal request.
 */
router.post(
  '/withdraw',
  requireRole('provider'),
  validate({ body: withdrawSchema }),
  withdraw
);

export default router;
