export interface WalletData {
  walletId: string;
  userId: string | null;
  type: string;
  currency: string;
  balance: number;
  formattedBalance: string;
  status: 'ACTIVE' | 'FROZEN' | 'CLOSED';
  createdAt: string;
}

export interface LedgerEntry {
  id: string;
  transactionId: string;
  referenceId: string;
  entryType: 'DEBIT' | 'CREDIT';
  amount: number;
  balanceAfter: number;
  formattedAmount: string;
  formattedBalanceAfter: string;
  description: string;
  createdAt: string;
}

export interface LedgerHistoryData {
  entries: LedgerEntry[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface DepositPayload {
  amount: number; // in integer paise (e.g. ₹100 = 10000)
  description?: string;
}

export interface DepositResult {
  referenceId: string;
  walletId: string;
  amount: number;
  formattedAmount: string;
  previousBalance: number;
  newBalance: number;
  formattedNewBalance: string;
  currency: string;
  status: string;
}
