import { Router } from 'express';
import { transferController } from './transfer.controller';
import { requireAuth } from '../../middleware/authMiddleware';

const router = Router();

// Transaction history endpoints require authentication
router.use(requireAuth);

/**
 * @route   GET /api/v1/transactions
 * @desc    Fetch authenticated user's paginated transactions
 */
router.get('/', transferController.getTransactions);

export default router;
