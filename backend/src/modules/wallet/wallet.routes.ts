import { Router } from 'express';
import { walletController } from './wallet.controller';
import { requireAuth } from '../../middleware/authMiddleware';
import { validate } from '../../middleware/validate';
import { depositSchema } from './wallet.types';

const router = Router();

// All wallet routes require valid JWT authentication
router.use(requireAuth);

/**
 * @route   GET /api/v1/wallets/me
 * @desc    Get authenticated user's active wallet and balance
 */
router.get('/me', walletController.getMyWallet);

/**
 * @route   GET /api/v1/wallets/me/ledger
 * @desc    Get paginated ledger audit trail for the authenticated user's wallet
 */
router.get('/me/ledger', walletController.getMyLedger);

/**
 * @route   POST /api/v1/wallets/me/deposit
 * @desc    Add demo funds into the authenticated user's wallet via platform gateway
 */
router.post('/me/deposit', validate({ body: depositSchema }), walletController.deposit);

export default router;
