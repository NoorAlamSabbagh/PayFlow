export interface TransferRequestInput {
  recipientId: string; // Recipient user UUID
  amount: number; // Integer paise (strictly > 0)
  currency?: string; // Default 'INR'
  description?: string;
  idempotencyKey: string;
}

export interface TransferReceiptDto {
  transactionId: string;
  referenceId: string;
  senderUserId: string;
  receiverUserId: string;
  recipientName?: string;
  recipientEmail?: string;
  senderWalletId: string;
  receiverWalletId: string;
  amount: number;
  formattedAmount: string;
  currency: string;
  status: 'COMPLETED' | 'PENDING' | 'FAILED';
  description: string;
  createdAt: string;
  completedAt?: string;
}

export interface TransactionDetailDto {
  id: string;
  referenceId: string;
  type: string;
  status: string;
  amount: number;
  formattedAmount: string;
  currency: string;
  direction: 'INCOMING' | 'OUTGOING' | 'INTERNAL';
  counterpartyName: string;
  counterpartyEmail: string;
  description: string;
  failureReason?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TransactionQueryFilter {
  page?: number;
  limit?: number;
  status?: string;
  direction?: 'INCOMING' | 'OUTGOING';
}

export interface PaginatedTransactionsDto {
  transactions: TransactionDetailDto[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface IdempotencyRecordEntity {
  id: string;
  user_id: string;
  key: string;
  request_path: string;
  request_hash: string;
  response_status: number | null;
  response_body: Record<string, unknown> | null;
  status: 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
  created_at: Date;
  expires_at: Date;
}
