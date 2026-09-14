export type PaymentStatus =
  | 'CREATED'
  | 'PROCESSING'
  | 'SUCCESS'
  | 'FAILED'
  | 'CANCELLED';

export interface PaymentIntentData {
  id: string;
  userId: string;
  walletId: string;
  amount: number; // in integer paise (₹1 = 100 paise)
  currency: string;
  provider: string;
  gatewayOrderId: string;
  gatewayPaymentId: string | null;
  status: PaymentStatus;
  errorMessage: string | null;
  clientSecret?: string;
  createdAt: string;
  completedAt: string | null;
}

export interface PaymentHistoryResponse {
  payments: PaymentIntentData[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}
