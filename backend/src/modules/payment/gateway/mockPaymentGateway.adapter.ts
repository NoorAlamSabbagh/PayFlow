import crypto from 'crypto';
import {
  IPaymentGateway,
  CreateOrderParams,
  PaymentOrderResult,
  WebhookVerificationResult,
  PaymentStatusResult,
} from './paymentGateway.interface';
import { config } from '../../../config';
import { logger } from '../../../config/logger';

export class MockPaymentGatewayAdapter implements IPaymentGateway {
  readonly providerName = 'MOCK_GATEWAY';
  private webhookSecret: string;

  constructor(webhookSecret?: string) {
    this.webhookSecret = webhookSecret || config.paymentGateway.mockWebhookSecret;
  }

  /**
   * Generates a deterministic or random mock order
   */
  async createOrder(params: CreateOrderParams): Promise<PaymentOrderResult> {
    const randomSuffix = crypto.randomBytes(6).toString('hex');
    const providerOrderId = `order_mock_${Date.now()}_${randomSuffix}`;

    logger.info('MockPaymentGateway: Created order', {
      providerOrderId,
      amount: params.amount,
      currency: params.currency,
      receipt: params.receipt,
    });

    return {
      providerOrderId,
      amount: params.amount,
      currency: params.currency,
      provider: this.providerName,
      clientSecret: `mock_secret_${randomSuffix}`,
      metadata: {
        receipt: params.receipt,
        ...params.notes,
      },
    };
  }

  /**
   * Helper utility to generate a valid HMAC signature for mock testing
   */
  generateSignature(payload: Buffer | string, secret?: string): string {
    const key = secret || this.webhookSecret;
    const data = Buffer.isBuffer(payload) ? payload : Buffer.from(payload, 'utf8');
    return crypto.createHmac('sha256', key).update(data).digest('hex');
  }

  /**
   * Verify HMAC-SHA256 signature using timingSafeEqual to guard against timing attacks
   */
  verifyWebhookSignature(
    rawBody: Buffer | string,
    signature: string,
    secret?: string
  ): boolean {
    if (!signature) return false;
    try {
      const key = secret || this.webhookSecret;
      const data = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody, 'utf8');
      const expectedSignature = crypto
        .createHmac('sha256', key)
        .update(data)
        .digest('hex');

      const expectedBuffer = Buffer.from(expectedSignature, 'utf8');
      const actualBuffer = Buffer.from(signature, 'utf8');

      if (expectedBuffer.length !== actualBuffer.length) {
        return false;
      }

      return crypto.timingSafeEqual(expectedBuffer, actualBuffer);
    } catch (err) {
      logger.error('MockPaymentGateway: Signature verification error', { error: err });
      return false;
    }
  }

  /**
   * Parse mock webhook JSON payload
   */
  parseWebhookEvent(
    rawBody: Buffer | string,
    headers: Record<string, string | string[] | undefined>
  ): WebhookVerificationResult {
    const bodyStr = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : rawBody;
    let payload: any;
    try {
      payload = JSON.parse(bodyStr);
    } catch (e) {
      return {
        isValid: false,
        eventType: 'UNKNOWN',
        gatewayEventId: 'invalid_json',
        gatewayOrderId: '',
        failureReason: 'Invalid JSON payload',
      };
    }

    const signature = (headers['x-mock-signature'] ||
      headers['x-razorpay-signature'] ||
      headers['x-signature']) as string;

    const isValid = this.verifyWebhookSignature(rawBody, signature);

    const event = payload.event || payload.eventType || '';
    const entity = payload.payload?.payment?.entity || payload.entity || payload;

    let eventType: 'PAYMENT_SUCCESS' | 'PAYMENT_FAILED' | 'PAYMENT_CANCELLED' | 'UNKNOWN' = 'UNKNOWN';
    if (event === 'payment.captured' || event === 'PAYMENT_SUCCESS' || event === 'payment.authorized') {
      eventType = 'PAYMENT_SUCCESS';
    } else if (event === 'payment.failed' || event === 'PAYMENT_FAILED') {
      eventType = 'PAYMENT_FAILED';
    } else if (event === 'payment.cancelled' || event === 'PAYMENT_CANCELLED') {
      eventType = 'PAYMENT_CANCELLED';
    }

    return {
      isValid,
      eventType,
      gatewayEventId: payload.event_id || payload.id || `mock_evt_${Date.now()}`,
      gatewayOrderId: entity.order_id || payload.order_id || payload.gatewayOrderId || '',
      gatewayPaymentId: entity.id || payload.payment_id || payload.gatewayPaymentId || `mock_pay_${Date.now()}`,
      amount: entity.amount || payload.amount,
      currency: entity.currency || payload.currency || 'INR',
      failureReason: entity.error_description || payload.error_message,
      metadata: payload.metadata || {},
    };
  }

  /**
   * Query status of mock payment
   */
  async getPaymentStatus(
    gatewayOrderId: string,
    gatewayPaymentId?: string
  ): Promise<PaymentStatusResult> {
    return {
      gatewayOrderId,
      gatewayPaymentId: gatewayPaymentId || `mock_pay_${gatewayOrderId}`,
      status: 'SUCCESS',
      amount: 100000,
      currency: 'INR',
    };
  }
}
