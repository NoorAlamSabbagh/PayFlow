export interface TransferRequestPayload {
  recipientId: string;
  amount: number; // Integer paise
  currency?: string; // Default 'INR'
  description?: string;
}

export interface TransferResult {
  transactionId: string;
  referenceId: string;
  senderUserId: string;
  receiverUserId: string;
  recipientName?: string;
  recipientEmail?: string;
  amount: number;
  formattedAmount: string;
  currency: string;
  status: 'COMPLETED' | 'PENDING' | 'FAILED';
  description: string;
  createdAt: string;
  completedAt?: string;
}

export interface TransactionItem {
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

export interface TransactionHistoryData {
  transactions: TransactionItem[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface CounterpartyOption {
  id: string;
  email: string;
  fullName: string;
}
