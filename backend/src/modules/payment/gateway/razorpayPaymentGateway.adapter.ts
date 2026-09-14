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

export class RazorpayPaymentGatewayAdapter implements IPaymentGateway {
  readonly providerName = 'RAZORPAY';
  private keyId: string;
  private keySecret: string;
  private webhookSecret: string;

  constructor() {
    this.keyId = config.paymentGateway.razorpayKeyId;
    this.keySecret = config.paymentGateway.razorpayKeySecret;
    this.webhookSecret = config.paymentGateway.razorpayWebhookSecret;
  }

  async createOrder(params: CreateOrderParams): Promise<PaymentOrderResult> {
    if (!this.keyId || !this.keySecret) {
      throw new Error(
        'Razorpay credentials are not configured. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in .env'
      );
    }

    const authHeader = `Basic ${Buffer.from(`${this.keyId}:${this.keySecret}`).toString('base64')}`;

    const response = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authHeader,
      },
      body: JSON.stringify({
        amount: params.amount, // Razorpay amounts are in integer paise
        currency: params.currency,
        receipt: params.receipt,
        notes: params.notes || {},
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      logger.error('Razorpay: Failed to create order', { status: response.status, body: errText });
      throw new Error(`Razorpay order creation failed: ${response.statusText}`);
    }

    const data: any = await response.json();

    return {
      providerOrderId: data.id,
      amount: data.amount,
      currency: data.currency,
      provider: this.providerName,
      metadata: {
        receipt: data.receipt,
        status: data.status,
      },
    };
  }

  verifyWebhookSignature(
    rawBody: Buffer | string,
    signature: string,
    secret?: string
  ): boolean {
    if (!signature) return false;
    try {
      const key = secret || this.webhookSecret;
      if (!key) {
        logger.error('Razorpay: Webhook secret not configured');
        return false;
      }
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
      logger.error('Razorpay: Signature verification error', { error: err });
      return false;
    }
  }

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

    const signature = headers['x-razorpay-signature'] as string;
    const isValid = this.verifyWebhookSignature(rawBody, signature);

    const event = payload.event || '';
    const paymentEntity = payload.payload?.payment?.entity;

    let eventType: 'PAYMENT_SUCCESS' | 'PAYMENT_FAILED' | 'PAYMENT_CANCELLED' | 'UNKNOWN' = 'UNKNOWN';
    if (event === 'payment.captured' || event === 'order.paid') {
      eventType = 'PAYMENT_SUCCESS';
    } else if (event === 'payment.failed') {
      eventType = 'PAYMENT_FAILED';
    }

    return {
      isValid,
      eventType,
      gatewayEventId: payload.event_id || payload.id || `rzp_evt_${Date.now()}`,
      gatewayOrderId: paymentEntity?.order_id || '',
      gatewayPaymentId: paymentEntity?.id || '',
      amount: paymentEntity?.amount,
      currency: paymentEntity?.currency || 'INR',
      failureReason: paymentEntity?.error_description,
      metadata: payload,
    };
  }

  async getPaymentStatus(
    gatewayOrderId: string,
    gatewayPaymentId?: string
  ): Promise<PaymentStatusResult> {
    const authHeader = `Basic ${Buffer.from(`${this.keyId}:${this.keySecret}`).toString('base64')}`;
    const url = gatewayPaymentId
      ? `https://api.razorpay.com/v1/payments/${gatewayPaymentId}`
      : `https://api.razorpay.com/v1/orders/${gatewayOrderId}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: { Authorization: authHeader },
    });

    if (!response.ok) {
      throw new Error(`Razorpay status fetch failed: ${response.statusText}`);
    }

    const data: any = await response.json();
    let status: 'SUCCESS' | 'FAILED' | 'PENDING' | 'CANCELLED' = 'PENDING';
    if (data.status === 'captured' || data.status === 'paid') {
      status = 'SUCCESS';
    } else if (data.status === 'failed') {
      status = 'FAILED';
    }

    return {
      gatewayOrderId: data.order_id || gatewayOrderId,
      gatewayPaymentId: data.id,
      status,
      amount: data.amount,
      currency: data.currency,
    };
  }
}
