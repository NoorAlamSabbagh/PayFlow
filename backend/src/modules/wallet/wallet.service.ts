import { PoolClient } from 'pg';
import { v4 as uuidv4 } from 'uuid';
import { walletRepository, WalletRepository } from './wallet.repository';
import { ledgerService, LedgerService } from '../ledger/ledger.service';
import {
  WalletEntity,
  WalletResponseDto,
  DepositInput,
  DepositResponseDto,
  SYSTEM_WALLETS,
  toWalletResponseDto,
} from './wallet.types';
import { LedgerHistoryResponseDto } from '../ledger/ledger.types';
import { getClient } from '../../database';
import { BadRequestError, NotFoundError } from '../../utils/errors';
import { logger } from '../../config/logger';

export class WalletService {
  constructor(
    private walletRepo: WalletRepository = walletRepository,
    private ledgerServ: LedgerService = ledgerService
  ) {}

  /**
   * Safe provisioning or retrieval of a user's primary INR wallet
   */
  async getOrCreateUserWallet(
    userId: string,
    currency = 'INR',
    client?: PoolClient
  ): Promise<WalletEntity> {
    const existing = await this.walletRepo.findByUserId(userId, currency, client);
    if (existing) {
      return existing;
    }

    // Provision new active wallet
    logger.info('Provisioning initial wallet for user', { userId, currency });
    return this.walletRepo.createWallet(
      {
        userId,
        type: 'USER',
        currency,
        initialBalance: 0n,
        status: 'ACTIVE',
      },
      client
    );
  }

  /**
   * Retrieve active wallet for authenticated user
   */
  async getWalletByUserId(userId: string): Promise<WalletResponseDto> {
    const wallet = await this.getOrCreateUserWallet(userId);
    return toWalletResponseDto(wallet);
  }

  /**
   * Internal Deposit / Add Money Primitive.
   * Executes atomic double-entry transaction between SYSTEM_GATEWAY_CLEARING and USER wallet.
   */
  async deposit(userId: string, input: DepositInput): Promise<DepositResponseDto> {
    const amountPaise = BigInt(input.amount);
    if (amountPaise <= 0n) {
      throw new BadRequestError('Deposit amount must be strictly greater than 0 paise', 'INVALID_AMOUNT');
    }

    const userWallet = await this.getOrCreateUserWallet(userId);
    if (userWallet.status !== 'ACTIVE') {
      throw new BadRequestError('User wallet is not active for financial transactions', 'WALLET_INACTIVE');
    }

    const referenceId = `TXN_DEP_${Date.now()}_${uuidv4().substring(0, 8).toUpperCase()}`;
    const client = await getClient();

    try {
      await client.query('BEGIN');

      // 1. Acquire deterministic row locks (ORDER BY id ASC) to eliminate race conditions and deadlocks
      const walletMap = await this.walletRepo.findAndLockWallets(
        [SYSTEM_WALLETS.GATEWAY_CLEARING, userWallet.id],
        client
      );

      const lockedClearing = walletMap.get(SYSTEM_WALLETS.GATEWAY_CLEARING);
      const lockedUserWallet = walletMap.get(userWallet.id);

      if (!lockedClearing || !lockedUserWallet) {
        throw new NotFoundError('Required counterparty wallets for deposit were not found', 'WALLET_NOT_FOUND');
      }

      if (lockedClearing.status !== 'ACTIVE' || lockedUserWallet.status !== 'ACTIVE') {
        throw new BadRequestError('Counterparty wallet is frozen or inactive', 'ACCOUNT_INACTIVE');
      }

      // 2. Compute exact integer balance updates
      const prevClearingBal = BigInt(lockedClearing.balance);
      const prevUserBal = BigInt(lockedUserWallet.balance);

      const newClearingBal = prevClearingBal + amountPaise;
      const newUserBal = prevUserBal + amountPaise;

      // 3. Post double-entry transaction into immutable ledger
      await this.ledgerServ.postDoubleEntryTransaction(
        {
          referenceId,
          type: 'TOPUP',
          amount: amountPaise,
          currency: 'INR',
          senderWalletId: SYSTEM_WALLETS.GATEWAY_CLEARING,
          receiverWalletId: lockedUserWallet.id,
          metadata: {
            depositMethod: 'MOCK_DEMO_TOPUP',
            initiatorUserId: userId,
            timestamp: new Date().toISOString(),
          },
          entries: [
            {
              walletId: SYSTEM_WALLETS.GATEWAY_CLEARING,
              entryType: 'DEBIT',
              amount: amountPaise,
              balanceAfter: newClearingBal,
              description: `Gateway Clearing Inflow: ${referenceId}`,
            },
            {
              walletId: lockedUserWallet.id,
              entryType: 'CREDIT',
              amount: amountPaise,
              balanceAfter: newUserBal,
              description: input.description || 'Demo Deposit via Platform Gateway',
            },
          ],
        },
        client
      );

      // 4. Synchronize cached balances under acquired row-locks
      await this.walletRepo.updateBalance(lockedClearing.id, newClearingBal, client);
      const updatedUserWallet = await this.walletRepo.updateBalance(lockedUserWallet.id, newUserBal, client);

      // 5. Commit atomic transaction
      await client.query('COMMIT');

      logger.info('Deposit transaction committed successfully', {
        userId,
        walletId: updatedUserWallet.id,
        referenceId,
        amount: amountPaise.toString(),
        newBalance: newUserBal.toString(),
      });

      const updatedUserBalNumber = parseInt(updatedUserWallet.balance, 10);
      const prevUserBalNumber = parseInt(prevUserBal.toString(), 10);
      const amountNumber = parseInt(amountPaise.toString(), 10);

      return {
        referenceId,
        walletId: updatedUserWallet.id,
        amount: amountNumber,
        formattedAmount: `₹${(amountNumber / 100).toLocaleString('en-IN', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}`,
        previousBalance: prevUserBalNumber,
        newBalance: updatedUserBalNumber,
        formattedNewBalance: `₹${(updatedUserBalNumber / 100).toLocaleString('en-IN', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}`,
        currency: updatedUserWallet.currency,
        status: 'COMPLETED',
      };
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Deposit transaction failed. Rolled back.', {
        userId,
        referenceId,
        error: (error as Error).message,
      });
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Retrieve ledger history for user's wallet
   */
  async getUserLedger(
    userId: string,
    page = 1,
    limit = 20
  ): Promise<LedgerHistoryResponseDto> {
    const wallet = await this.getOrCreateUserWallet(userId);
    return this.ledgerServ.getWalletLedgerHistory(wallet.id, page, limit);
  }
}

export const walletService = new WalletService();
