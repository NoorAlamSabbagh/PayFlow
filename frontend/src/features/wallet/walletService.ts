import { api } from '../../api/client';
import { ApiResponse } from '../auth/authTypes';
import { WalletData, LedgerHistoryData, DepositPayload, DepositResult } from './walletTypes';

export const walletService = {
  /**
   * Fetch current user's wallet
   */
  getMyWallet: async (): Promise<WalletData> => {
    const response = await api.get<ApiResponse<WalletData>>('/wallets/me');
    return response.data.data;
  },

  /**
   * Fetch paginated double-entry ledger history
   */
  getMyLedger: async (page = 1, limit = 15): Promise<LedgerHistoryData> => {
    const response = await api.get<ApiResponse<LedgerHistoryData>>('/wallets/me/ledger', {
      params: { page, limit },
    });
    return response.data.data;
  },

  /**
   * Post demo funds into user's wallet via platform gateway
   */
  deposit: async (payload: DepositPayload): Promise<DepositResult> => {
    const response = await api.post<ApiResponse<DepositResult>>('/wallets/me/deposit', payload);
    return response.data.data;
  },
};
