/**
 * Payment Gateway Abstraction Interfaces
 * Decouples PayFlow financial business logic from external gateway SDKs / APIs
 */

export interface CreateOrderParams {
  amount: number; // Stored in integer paise (₹1 = 100 paise)
  currency: string;
  receipt: string;
  notes?: Record<string, string>;
}

export interface PaymentOrderResult {
  providerOrderId: string;
  amount: number;
  currency: string;
  provider: string;
  clientSecret?: string;
  metadata?: Record<string, unknown>;
}

export interface WebhookVerificationResult {
  isValid: boolean;
  eventType: 'PAYMENT_SUCCESS' | 'PAYMENT_FAILED' | 'PAYMENT_CANCELLED' | 'UNKNOWN';
  gatewayEventId: string;
  gatewayOrderId: string;
  gatewayPaymentId?: string;
  amount?: number;
  currency?: string;
  failureReason?: string;
  metadata?: Record<string, unknown>;
}

export interface PaymentStatusResult {
  gatewayOrderId: string;
  gatewayPaymentId?: string;
  status: 'SUCCESS' | 'FAILED' | 'PENDING' | 'CANCELLED';
  amount: number;
  currency: string;
}

export interface IPaymentGateway {
  readonly providerName: string;

  /**
   * Create an external order / intent on the payment provider
   */
  createOrder(params: CreateOrderParams): Promise<PaymentOrderResult>;

  /**
   * Cryptographically verify an inbound webhook signature
   */
  verifyWebhookSignature(
    rawBody: Buffer | string,
    signature: string,
    secret?: string
  ): boolean;

  /**
   * Parse the verified webhook event into a standardized PayFlow verification result
   */
  parseWebhookEvent(
    rawBody: Buffer | string,
    headers: Record<string, string | string[] | undefined>
  ): WebhookVerificationResult;

  /**
   * Fetch current status of a payment/order directly from the gateway
   */
  getPaymentStatus(
    gatewayOrderId: string,
    gatewayPaymentId?: string
  ): Promise<PaymentStatusResult>;
}
