export type PaymentIntentStatus =
  | 'CREATED'
  | 'PROCESSING'
  | 'SUCCESS'
  | 'FAILED'
  | 'CANCELLED';

export interface PaymentIntentEntity {
  id: string;
  userId: string;
  walletId: string;
  amount: bigint;
  currency: string;
  provider: string;
  gatewayOrderId: string;
  gatewayPaymentId: string | null;
  status: PaymentIntentStatus;
  idempotencyKey: string | null;
  errorMessage: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
}

export interface PaymentIntentResponseDTO {
  id: string;
  userId: string;
  walletId: string;
  amount: number; // in paise
  currency: string;
  provider: string;
  gatewayOrderId: string;
  gatewayPaymentId: string | null;
  status: PaymentIntentStatus;
  errorMessage: string | null;
  clientSecret?: string;
  createdAt: string;
  completedAt: string | null;
}

export interface CreatePaymentIntentInput {
  userId: string;
  amount: number; // in integer paise (₹1 = 100 paise)
  currency?: string;
  idempotencyKey: string;
  provider?: string;
}

export interface ListPaymentIntentsQuery {
  page?: number;
  limit?: number;
  status?: PaymentIntentStatus;
}
