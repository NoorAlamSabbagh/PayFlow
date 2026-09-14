import { Router } from 'express';
import { webhookController } from './webhook.controller';

const router = Router();

/**
 * @route   POST /api/v1/webhooks/payment-gateway
 * @desc    Inbound authoritative webhook receiver for payment gateways (Razorpay / Mock)
 * @access  Public (Authoritative HMAC-SHA256 signature verification enforced)
 */
router.post('/payment-gateway', webhookController.handleGatewayWebhook);

export default router;
