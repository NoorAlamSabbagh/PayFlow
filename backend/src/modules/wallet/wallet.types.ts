import { z } from 'zod';

export type WalletType = 'USER' | 'SYSTEM_ESCROW' | 'SYSTEM_FEES' | 'SYSTEM_GATEWAY_CLEARING';
export type WalletStatus = 'ACTIVE' | 'FROZEN' | 'CLOSED';

export const SYSTEM_WALLETS = {
  GATEWAY_CLEARING: '00000000-0000-0000-0000-000000000001',
  ESCROW: '00000000-0000-0000-0000-000000000002',
  FEES: '00000000-0000-0000-0000-000000000003',
} as const;

export interface WalletEntity {
  id: string;
  user_id: string | null;
  type: WalletType;
  currency: string;
  balance: string; // BIGINT representation
  version: string;
  status: WalletStatus;
  created_at: Date;
  updated_at: Date;
}

export interface WalletResponseDto {
  walletId: string;
  userId: string | null;
  type: WalletType;
  currency: string;
  balance: number;
  formattedBalance: string;
  status: WalletStatus;
  createdAt: string;
}

export const depositSchema = z.object({
  amount: z
    .number({ required_error: 'Amount is required' })
    .int('Amount must be an integer in smallest currency unit (paise)')
    .positive('Amount must be strictly greater than 0')
    .max(10_000_000, 'Single deposit cannot exceed ₹100,000 (10,000,000 paise)'),
  description: z.string().max(255).optional(),
});

export type DepositInput = z.infer<typeof depositSchema>;

export interface DepositResponseDto {
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

export function toWalletResponseDto(entity: WalletEntity): WalletResponseDto {
  const balancePaise = parseInt(entity.balance, 10);
  return {
    walletId: entity.id,
    userId: entity.user_id,
    type: entity.type,
    currency: entity.currency,
    balance: balancePaise,
    formattedBalance: `₹${(balancePaise / 100).toLocaleString('en-IN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`,
    status: entity.status,
    createdAt: entity.created_at.toISOString(),
  };
}
