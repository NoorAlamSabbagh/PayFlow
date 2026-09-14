export type LedgerEntryType = 'DEBIT' | 'CREDIT';
export type TransactionType = 'TOPUP' | 'P2P_TRANSFER' | 'REFUND' | 'FEE' | 'ADJUSTMENT';
export type TransactionStatus = 'PENDING' | 'COMPLETED' | 'FAILED' | 'REVERSED';

export interface LedgerEntryEntity {
  id: string;
  transaction_id: string;
  wallet_id: string;
  entry_type: LedgerEntryType;
  amount: string; // BIGINT is returned as string from pg
  balance_after: string;
  description: string;
  created_at: Date;
}

export interface TransactionEntity {
  id: string;
  reference_id: string;
  type: TransactionType;
  status: TransactionStatus;
  amount: string;
  currency: string;
  sender_wallet_id: string | null;
  receiver_wallet_id: string | null;
  failure_reason: string | null;
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

export interface CreateTransactionRecordInput {
  referenceId: string;
  type: TransactionType;
  status: TransactionStatus;
  amount: bigint;
  currency: string;
  senderWalletId: string | null;
  receiverWalletId: string | null;
  metadata?: Record<string, unknown>;
}

export interface PostLedgerEntryInput {
  walletId: string;
  entryType: LedgerEntryType;
  amount: bigint;
  balanceAfter: bigint;
  description: string;
}

export interface DoubleEntryTransactionInput {
  referenceId: string;
  type: TransactionType;
  amount: bigint;
  currency: string;
  senderWalletId: string | null;
  receiverWalletId: string | null;
  metadata?: Record<string, unknown>;
  entries: PostLedgerEntryInput[];
}

export interface LedgerEntryResponseDto {
  id: string;
  transactionId: string;
  referenceId: string;
  entryType: LedgerEntryType;
  amount: number;
  balanceAfter: number;
  formattedAmount: string;
  formattedBalanceAfter: string;
  description: string;
  createdAt: string;
}

export interface LedgerHistoryResponseDto {
  entries: LedgerEntryResponseDto[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}
