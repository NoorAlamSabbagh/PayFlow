import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { transferRepository, TransferRepository } from './transfer.repository';
import { walletRepository, WalletRepository } from '../wallet/wallet.repository';
import { walletService, WalletService } from '../wallet/wallet.service';
import { ledgerService, LedgerService } from '../ledger/ledger.service';
import { userRepository, UserRepository } from '../user/user.repository';
import {
  TransferRequestInput,
  TransferReceiptDto,
  TransactionQueryFilter,
  PaginatedTransactionsDto,
  TransactionDetailDto,
} from './transfer.types';
import { getClient } from '../../database';
import { redisClient } from '../../config/redis';
import { logger } from '../../config/logger';
import {
  BadRequestError,
  NotFoundError,
  ConflictError,
  ForbiddenError,
} from '../../utils/errors';

export class TransferService {
  constructor(
    private transferRepo: TransferRepository = transferRepository,
    private walletRepo: WalletRepository = walletRepository,
    private walletServ: WalletService = walletService,
    private ledgerServ: LedgerService = ledgerService,
    private userRepo: UserRepository = userRepository
  ) {}

  /**
   * Generates deterministic SHA-256 hash of transfer payload for idempotency mismatch guard
   */
  private computePayloadHash(payload: {
    recipientId: string;
    amount: number;
    currency: string;
    description: string;
  }): string {
    const canonical = JSON.stringify({
      recipientId: payload.recipientId,
      amount: payload.amount,
      currency: payload.currency,
      description: payload.description || '',
    });
    return crypto.createHash('sha256').update(canonical).digest('hex');
  }

  /**
   * Execute atomic P2P Money Transfer with dual-layer idempotency and deadlock-free locking
   */
  async executeTransfer(
    senderUserId: string,
    input: TransferRequestInput
  ): Promise<TransferReceiptDto> {
    const currency = input.currency || 'INR';
    const description = input.description || 'P2P Transfer';
    const amountPaise = BigInt(input.amount);

    // 1. Basic Amount & Self-Transfer Validation
    if (amountPaise <= 0n) {
      throw new BadRequestError('Transfer amount must be strictly greater than 0 paise', 'INVALID_AMOUNT');
    }

    if (senderUserId === input.recipientId) {
      throw new BadRequestError('Self-transfer is prohibited. Sender and recipient must be distinct', 'SELF_TRANSFER_PROHIBITED');
    }

    // 2. Validate Recipient User & Account State
    const recipient = await this.userRepo.findById(input.recipientId);
    if (!recipient || !recipient.is_active) {
      throw new NotFoundError('Recipient account not found or is deactivated', 'RECIPIENT_NOT_FOUND');
    }

    const sender = await this.userRepo.findById(senderUserId);
    if (!sender || !sender.is_active) {
      throw new ForbiddenError('Sender account is suspended or inactive', 'SENDER_INACTIVE');
    }

    // 3. Compute Canonical Payload Hash
    const requestHash = this.computePayloadHash({
      recipientId: input.recipientId,
      amount: input.amount,
      currency,
      description,
    });

    const lockKey = `idempotency:${senderUserId}:${input.idempotencyKey}`;

    // 4. L1 Idempotency Guard: Fast-path in-flight Redis Mutex (30s TTL)
    let acquiredRedisLock = false;
    try {
      const lockResult = await redisClient.set(lockKey, 'IN_PROGRESS', 'PX', 30000, 'NX');
      if (!lockResult) {
        logger.warn('L1 Idempotency Conflict: Concurrent duplicate request in-flight', {
          userId: senderUserId,
          key: input.idempotencyKey,
        });
        throw new ConflictError(
          'A transfer request with this Idempotency-Key is currently in progress. Please wait for completion.',
          'IDEMPOTENCY_IN_PROGRESS'
        );
      }
      acquiredRedisLock = true;
    } catch (err) {
      if (err instanceof ConflictError) {
        throw err;
      }
      logger.warn('Redis L1 idempotency unavailable, falling back to PostgreSQL L2 store', {
        error: (err as Error).message,
      });
    }

    // 5. L2 Idempotency Guard: PostgreSQL Durable Store Check
    const existingIdemp = await this.transferRepo.findIdempotencyKey(
      senderUserId,
      input.idempotencyKey
    );

    if (existingIdemp) {
      // Release Redis lock since this request is already resolved
      if (acquiredRedisLock) {
        await redisClient.del(lockKey).catch(() => {});
      }

      // Check for parameter mutation attack (Same key, different payload)
      if (existingIdemp.request_hash !== requestHash) {
        logger.warn('Idempotency Tampering Detected: Payload hash mismatch for key', {
          userId: senderUserId,
          key: input.idempotencyKey,
          storedHash: existingIdemp.request_hash,
          newHash: requestHash,
        });
        throw new ConflictError(
          'Idempotency-Key has already been used with a different transfer payload',
          'IDEMPOTENCY_PAYLOAD_MISMATCH'
        );
      }

      if (existingIdemp.status === 'COMPLETED' && existingIdemp.response_body) {
        logger.info('L2 Idempotency Hit: Replaying cached transfer receipt', {
          userId: senderUserId,
          key: input.idempotencyKey,
        });
        return existingIdemp.response_body as unknown as TransferReceiptDto;
      }

      if (existingIdemp.status === 'IN_PROGRESS') {
        throw new ConflictError(
          'A transfer request with this Idempotency-Key is currently processing.',
          'IDEMPOTENCY_IN_PROGRESS'
        );
      }
    }

    // 6. Ensure Sender and Recipient Wallets are Active
    const senderWallet = await this.walletServ.getOrCreateUserWallet(senderUserId, currency);
    const receiverWallet = await this.walletServ.getOrCreateUserWallet(input.recipientId, currency);

    if (senderWallet.status !== 'ACTIVE') {
      if (acquiredRedisLock) await redisClient.del(lockKey).catch(() => {});
      throw new BadRequestError('Sender wallet is frozen or inactive', 'SENDER_WALLET_INACTIVE');
    }

    if (receiverWallet.status !== 'ACTIVE') {
      if (acquiredRedisLock) await redisClient.del(lockKey).catch(() => {});
      throw new BadRequestError('Recipient wallet is frozen or inactive', 'RECIPIENT_WALLET_INACTIVE');
    }

    // 7. Begin Atomic Database Transaction
    const referenceId = `TXN_TRF_${Date.now()}_${uuidv4().substring(0, 8).toUpperCase()}`;
    const client = await getClient();

    try {
      await client.query('BEGIN');

      // CRITICAL: Deterministic Lock Acquisition Order (ORDER BY id ASC)
      // Sorting wallet UUIDs eliminates cyclic wait conditions, completely preventing database deadlocks.
      const [firstLockId, secondLockId] = [senderWallet.id, receiverWallet.id].sort();
      const walletMap = await this.walletRepo.findAndLockWallets(
        [firstLockId, secondLockId],
        client
      );

      const lockedSender = walletMap.get(senderWallet.id);
      const lockedReceiver = walletMap.get(receiverWallet.id);

      if (!lockedSender || !lockedReceiver) {
        throw new NotFoundError('One or both counterparty wallets were not found', 'WALLET_NOT_FOUND');
      }

      // Re-verify sufficient balance under exclusive row-lock
      const senderBal = BigInt(lockedSender.balance);
      if (senderBal < amountPaise) {
        logger.warn('Transfer rejected: Insufficient funds under lock', {
          senderUserId,
          walletId: lockedSender.id,
          currentBalance: senderBal.toString(),
          requestedAmount: amountPaise.toString(),
        });
        throw new BadRequestError(
          `Insufficient wallet balance. Available: ₹${(Number(senderBal) / 100).toFixed(2)}, Required: ₹${(Number(amountPaise) / 100).toFixed(2)}`,
          'INSUFFICIENT_FUNDS'
        );
      }

      // Compute exact integer balances
      const senderNewBal = senderBal - amountPaise;
      const receiverNewBal = BigInt(lockedReceiver.balance) + amountPaise;

      // Update balances within locked transaction
      await this.walletRepo.updateBalance(lockedSender.id, senderNewBal, client);
      await this.walletRepo.updateBalance(lockedReceiver.id, receiverNewBal, client);

      // Post balanced double-entry ledger records
      const { transaction } = await this.ledgerServ.postDoubleEntryTransaction(
        {
          referenceId,
          type: 'P2P_TRANSFER',
          amount: amountPaise,
          currency,
          senderWalletId: lockedSender.id,
          receiverWalletId: lockedReceiver.id,
          metadata: {
            senderUserId,
            senderName: sender.full_name,
            receiverUserId: input.recipientId,
            receiverName: recipient.full_name,
            description,
            idempotencyKey: input.idempotencyKey,
            timestamp: new Date().toISOString(),
          },
          entries: [
            {
              walletId: lockedSender.id,
              entryType: 'DEBIT',
              amount: amountPaise,
              balanceAfter: senderNewBal,
              description: `P2P Transfer to ${recipient.full_name}: ${description}`,
            },
            {
              walletId: lockedReceiver.id,
              entryType: 'CREDIT',
              amount: amountPaise,
              balanceAfter: receiverNewBal,
              description: `P2P Transfer from ${sender.full_name}: ${description}`,
            },
          ],
        },
        client
      );

      // Construct Transfer Receipt
      const receipt: TransferReceiptDto = {
        transactionId: transaction.id,
        referenceId: transaction.reference_id,
        senderUserId,
        receiverUserId: input.recipientId,
        recipientName: recipient.full_name,
        recipientEmail: recipient.email,
        senderWalletId: lockedSender.id,
        receiverWalletId: lockedReceiver.id,
        amount: input.amount,
        formattedAmount: `₹${(input.amount / 100).toLocaleString('en-IN', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}`,
        currency,
        status: 'COMPLETED',
        description,
        createdAt: transaction.created_at.toISOString(),
        completedAt: new Date().toISOString(),
      };

      // Transactional Outbox Pattern: Insert event in the SAME transaction
      await this.transferRepo.createOutboxEvent(
        {
          aggregateType: 'TRANSACTION',
          aggregateId: transaction.id,
          eventType: 'TRANSFER_COMPLETED',
          payload: {
            transactionId: transaction.id,
            referenceId: transaction.reference_id,
            senderUserId,
            receiverUserId: input.recipientId,
            amount: input.amount,
            currency,
            createdAt: receipt.createdAt,
          },
        },
        client
      );

      // Save to L2 Idempotency Store in the SAME transaction
      await this.transferRepo.saveIdempotencyKey(
        {
          userId: senderUserId,
          key: input.idempotencyKey,
          requestPath: '/api/v1/transfers',
          requestHash,
          responseStatus: 200,
          responseBody: receipt as unknown as Record<string, unknown>,
          ttlHours: 24,
        },
        client
      );

      // Commit transaction atomically
      await client.query('COMMIT');

      logger.info('P2P Transfer completed successfully', {
        transactionId: transaction.id,
        referenceId,
        senderUserId,
        recipientId: input.recipientId,
        amount: input.amount,
      });

      return receipt;
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('P2P Transfer failed and rolled back', {
        senderUserId,
        recipientId: input.recipientId,
        error: (error as Error).message,
      });
      throw error;
    } finally {
      client.release();
      // Clean up Redis in-flight mutex lock
      if (acquiredRedisLock) {
        await redisClient.del(lockKey).catch(() => {});
      }
    }
  }

  /**
   * Fetch authenticated user's paginated transaction history
   */
  async getTransactionHistory(
    userId: string,
    filter: TransactionQueryFilter
  ): Promise<PaginatedTransactionsDto> {
    const wallet = await this.walletServ.getOrCreateUserWallet(userId);
    const safePage = Math.max(1, filter.page || 1);
    const safeLimit = Math.min(100, Math.max(1, filter.limit || 15));
    const offset = (safePage - 1) * safeLimit;

    const { transactions, total } = await this.transferRepo.findTransactionsByWalletId(
      wallet.id,
      {
        limit: safeLimit,
        offset,
        status: filter.status,
        direction: filter.direction,
      }
    );

    const formattedList: TransactionDetailDto[] = transactions.map((tx) => {
      const amountPaise = parseInt(tx.amount, 10);
      const isOutgoing = tx.sender_wallet_id === wallet.id;
      const isIncoming = tx.receiver_wallet_id === wallet.id;

      let direction: 'INCOMING' | 'OUTGOING' | 'INTERNAL' = 'INTERNAL';
      let counterpartyName = 'Platform';
      let counterpartyEmail = 'system@payflow.internal';

      if (isOutgoing) {
        direction = 'OUTGOING';
        counterpartyName = tx.receiver_name || 'Counterparty';
        counterpartyEmail = tx.receiver_email || 'user@payflow.internal';
      } else if (isIncoming) {
        direction = 'INCOMING';
        counterpartyName = tx.sender_name || 'Counterparty';
        counterpartyEmail = tx.sender_email || 'user@payflow.internal';
      }

      return {
        id: tx.id,
        referenceId: tx.reference_id,
        type: tx.type,
        status: tx.status,
        amount: amountPaise,
        formattedAmount: `${direction === 'OUTGOING' ? '-' : '+'}₹${(amountPaise / 100).toLocaleString('en-IN', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}`,
        currency: tx.currency,
        direction,
        counterpartyName,
        counterpartyEmail,
        description: (tx.metadata as { description?: string })?.description || `${tx.type} Transaction`,
        failureReason: tx.failure_reason || undefined,
        createdAt: tx.created_at.toISOString(),
        updatedAt: tx.updated_at.toISOString(),
      };
    });

    return {
      transactions: formattedList,
      pagination: {
        page: safePage,
        limit: safeLimit,
        total,
        totalPages: Math.ceil(total / safeLimit) || 1,
      },
    };
  }

  /**
   * Fetch single transfer detail ensuring strict authorization (sender or receiver only)
   */
  async getTransferById(userId: string, transactionId: string): Promise<TransactionDetailDto> {
    const tx = await this.transferRepo.findTransactionById(transactionId);
    if (!tx) {
      throw new NotFoundError('Transaction not found', 'TRANSACTION_NOT_FOUND');
    }

    const wallet = await this.walletServ.getOrCreateUserWallet(userId);
    const isSender = tx.sender_wallet_id === wallet.id;
    const isReceiver = tx.receiver_wallet_id === wallet.id;

    if (!isSender && !isReceiver) {
      throw new ForbiddenError('You are not authorized to view this transaction', 'TRANSACTION_ACCESS_DENIED');
    }

    const amountPaise = parseInt(tx.amount, 10);
    const direction = isSender ? 'OUTGOING' : 'INCOMING';

    return {
      id: tx.id,
      referenceId: tx.reference_id,
      type: tx.type,
      status: tx.status,
      amount: amountPaise,
      formattedAmount: `${direction === 'OUTGOING' ? '-' : '+'}₹${(amountPaise / 100).toLocaleString('en-IN', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`,
      currency: tx.currency,
      direction,
      counterpartyName: isSender ? (tx.receiver_name || 'Recipient') : (tx.sender_name || 'Sender'),
      counterpartyEmail: isSender ? (tx.receiver_email || '') : (tx.sender_email || ''),
      description: (tx.metadata as { description?: string })?.description || 'Transfer',
      failureReason: tx.failure_reason || undefined,
      createdAt: tx.created_at.toISOString(),
      updatedAt: tx.updated_at.toISOString(),
    };
  }
}

export const transferService = new TransferService();
