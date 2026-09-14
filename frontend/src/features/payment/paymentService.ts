import { api } from '../../api/client';
import { ApiResponse } from '../auth/authTypes';
import { PaymentIntentData, PaymentHistoryResponse } from './paymentTypes';

// Helper to compute HMAC-SHA256 signature in browser using standard Web Crypto API
async function computeMockHmacSignature(message: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signatureBuf = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return Array.from(new Uint8Array(signatureBuf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export const paymentService = {
  /**
   * Create an authoritative payment intent on PayFlow backend
   */
  createIntent: async (
    amountPaise: number,
    idempotencyKey: string,
    provider = 'MOCK_GATEWAY'
  ): Promise<PaymentIntentData> => {
    const response = await api.post<ApiResponse<PaymentIntentData>>(
      '/payments/intents',
      { amount: amountPaise, currency: 'INR', provider },
      {
        headers: {
          'Idempotency-Key': idempotencyKey,
        },
      }
    );
    return response.data.data;
  },

  /**
   * Fetch payment intent status (used for authoritative polling)
   */
  getIntentStatus: async (paymentIntentId: string): Promise<PaymentIntentData> => {
    const response = await api.get<ApiResponse<PaymentIntentData>>(
      `/payments/${paymentIntentId}`
    );
    return response.data.data;
  },

  /**
   * Fetch paginated list of user's payment attempts
   */
  listPayments: async (
    page = 1,
    limit = 10,
    status?: string
  ): Promise<PaymentHistoryResponse> => {
    const response = await api.get<ApiResponse<PaymentHistoryResponse>>('/payments', {
      params: { page, limit, status },
    });
    return response.data.data;
  },

  /**
   * Trigger authoritative mock webhook from client with real cryptographically computed HMAC-SHA256
   * Demonstrates full end-to-end out-of-band webhook settlement
   */
  triggerMockWebhook: async (params: {
    orderId: string;
    amountPaise: number;
    eventType: 'PAYMENT_SUCCESS' | 'PAYMENT_FAILED';
    failureReason?: string;
  }): Promise<void> => {
    const secret = 'dev_mock_webhook_secret_for_testing_purposes';
    const isSuccess = params.eventType === 'PAYMENT_SUCCESS';
    const eventId = `evt_mock_${Date.now()}`;
    const paymentId = `pay_mock_${Date.now()}`;

    const payload = isSuccess
      ? {
        event: 'payment.captured',
        id: eventId,
        payload: {
          payment: {
            entity: {
              id: paymentId,
              order_id: params.orderId,
              amount: params.amountPaise,
              currency: 'INR',
            },
          },
        },
      }
      : {
        event: 'payment.failed',
        id: eventId,
        payload: {
          payment: {
            entity: {
              id: paymentId,
              order_id: params.orderId,
              amount: params.amountPaise,
              currency: 'INR',
              error_description: params.failureReason || 'Card declined by simulator',
            },
          },
        },
      };

    const rawPayload = JSON.stringify(payload);
    const signature = await computeMockHmacSignature(rawPayload, secret);

    await api.post('/webhooks/payment-gateway', payload, {
      headers: {
        'Content-Type': 'application/json',
        'x-mock-signature': signature,
      },
    });
  },
};