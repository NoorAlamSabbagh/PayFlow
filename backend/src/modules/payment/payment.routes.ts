import { Router } from 'express';
import { paymentController } from './payment.controller';
import { requireAuth } from '../../middleware/authMiddleware';
import { requireRole } from '../../middleware/rbacMiddleware';

const router = Router();

// All payment routes require valid JWT authentication
router.use(requireAuth);

/**
 * @route   POST /api/v1/payments/intents
 * @desc    Create an external payment order / intent with dual-layer idempotency
 * @access  Private (USER, ADMIN)
 */
router.post('/intents', paymentController.createIntent);

/**
 * @route   GET /api/v1/payments
 * @desc    List user's payment history with pagination and status filtering
 * @access  Private (USER, ADMIN)
 */
router.get('/', paymentController.listMyPayments);

/**
 * @route   GET /api/v1/payments/:paymentIntentId
 * @desc    Fetch payment intent status and details
 * @access  Private (USER, ADMIN)
 */
router.get('/:paymentIntentId', paymentController.getIntent);

/**
 * @route   GET /api/v1/payments/admin/all
 * @desc    System-wide payment intent overview
 * @access  Private (ADMIN only)
 */
router.get('/admin/all', requireRole('ADMIN'), paymentController.listAdminPayments);

/**
 * @route   POST /api/v1/payments/admin/:id/reconcile
 * @desc    Audit reconciliation of payment intent vs gateway status and double-entry ledger
 * @access  Private (ADMIN only)
 */
router.post('/admin/:id/reconcile', requireRole('ADMIN'), paymentController.reconcilePayment);

export default router;
