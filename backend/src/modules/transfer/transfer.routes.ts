import { Router } from 'express';
import { transferController } from './transfer.controller';
import { requireAuth } from '../../middleware/authMiddleware';
import { validate } from '../../middleware/validate';
import { transferBodySchema } from './transfer.validation';

const router = Router();

// All transfer and transaction endpoints require valid authentication
router.use(requireAuth);

/**
 * @route   POST /api/v1/transfers
 * @desc    Execute atomic P2P money transfer with row lock & idempotency
 */
router.post('/', validate({ body: transferBodySchema }), transferController.createTransfer);

/**
 * @route   GET /api/v1/transfers/:id
 * @desc    Retrieve single transfer detail (ownership verified)
 */
router.get('/:id', transferController.getTransferDetail);

export default router;
