import { api } from '../../api/client';
import { ApiResponse } from '../auth/authTypes';
import {
  TransferRequestPayload,
  TransferResult,
  TransactionHistoryData,
  CounterpartyOption,
  TransactionItem,
} from './transferTypes';

export const transferService = {
  /**
   * Execute P2P money transfer with client-generated Idempotency-Key
   */
  createTransfer: async (
    payload: TransferRequestPayload,
    idempotencyKey?: string
  ): Promise<TransferResult> => {
    // Generate UUIDv4 idempotency key if not supplied
    const key = idempotencyKey || crypto.randomUUID();

    const response = await api.post<ApiResponse<TransferResult>>(
      '/transfers',
      payload,
      {
        headers: {
          'Idempotency-Key': key,
        },
      }
    );
    return response.data.data;
  },

  /**
   * Fetch authenticated user's paginated transactions
   */
  getTransactions: async (
    page = 1,
    limit = 15,
    status?: string,
    direction?: 'INCOMING' | 'OUTGOING'
  ): Promise<TransactionHistoryData> => {
    const response = await api.get<ApiResponse<TransactionHistoryData>>('/transactions', {
      params: { page, limit, status, direction },
    });
    return response.data.data;
  },

  /**
   * Fetch single transfer detail by UUID
   */
  getTransferDetail: async (transactionId: string): Promise<TransactionItem> => {
    const response = await api.get<ApiResponse<TransactionItem>>(`/transfers/${transactionId}`);
    return response.data.data;
  },

  /**
   * Fetch counterparties list for instant recipient selection
   */
  getCounterparties: async (search = ''): Promise<CounterpartyOption[]> => {
    const response = await api.get<ApiResponse<CounterpartyOption[]>>('/users/counterparties', {
      params: { search },
    });
    return response.data.data;
  },
};
