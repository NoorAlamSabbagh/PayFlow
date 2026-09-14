import crypto from 'crypto';
import { PaymentRepository } from './payment.repository';
import { PaymentGatewayFactory } from './gateway/paymentGateway.factory';
import {
  CreatePaymentIntentInput,
  PaymentIntentResponseDTO,
  ListPaymentIntentsQuery,
  PaymentIntentEntity,
} from './payment.types';
import { WalletService, walletService } from '../wallet/wallet.service';
import { redisClient } from '../../config/redis';
import { pool } from '../../database';
import { logger } from '../../config/logger';
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from '../../utils/errors';

export class PaymentService {
  constructor(
    private paymentRepo: PaymentRepository = new PaymentRepository(),
    private walletServ: WalletService = walletService
  ) {}

  private mapEntityToDTO(
    entity: PaymentIntentEntity,
    clientSecret?: string
  ): PaymentIntentResponseDTO {
    return {
      id: entity.id,
      userId: entity.userId,
      walletId: entity.walletId,
      amount: Number(entity.amount),
      currency: entity.currency,
      provider: entity.provider,
      gatewayOrderId: entity.gatewayOrderId,
      gatewayPaymentId: entity.gatewayPaymentId,
      status: entity.status,
      errorMessage: entity.errorMessage,
      clientSecret: clientSecret || (entity.metadata?.clientSecret as string | undefined),
      createdAt: entity.createdAt.toISOString(),
      completedAt: entity.completedAt ? entity.completedAt.toISOString() : null,
    };
  }

  private computePayloadHash(payload: {
    userId: string;
    amount: number;
    currency: string;
  }): string {
    const canonical = JSON.stringify({
      userId: payload.userId,
      amount: payload.amount,
      currency: payload.currency,
    });
    return crypto.createHash('sha256').update(canonical).digest('hex');
  }

  async createPaymentIntent(
    input: CreatePaymentIntentInput
  ): Promise<PaymentIntentResponseDTO> {
    const currency = input.currency || 'INR';

    if (!Number.isInteger(input.amount) || input.amount <= 0) {
      throw new BadRequestError(
        'Amount must be a positive integer in smallest currency units (paise)',
        'INVALID_INTEGER_AMOUNT'
      );
    }

    if (!input.idempotencyKey) {
      throw new BadRequestError(
        'Idempotency-Key header is required for payment intent creation',
        'MISSING_IDEMPOTENCY_KEY'
      );
    }

    // 1. Verify User has active wallet
    const userWallet = await this.walletServ.getOrCreateUserWallet(input.userId, currency);
    if (userWallet.status !== 'ACTIVE') {
      throw new BadRequestError(
        'User wallet is not active for deposits',
        'WALLET_INACTIVE'
      );
    }

    const requestHash = this.computePayloadHash({
      userId: input.userId,
      amount: input.amount,
      currency,
    });

    const lockKey = `idempotency:intent:${input.userId}:${input.idempotencyKey}`;
    let acquiredRedisLock = false;

    // 2. L1 Idempotency: Redis Distributed Lock
    try {
      const lockAcquired = await redisClient.set(lockKey, 'IN_PROGRESS', 'EX', 15, 'NX');
      if (!lockAcquired) {
        throw new ConflictError(
          'A payment intent creation with this Idempotency-Key is currently in progress',
          'IDEMPOTENCY_IN_PROGRESS'
        );
      }
      acquiredRedisLock = true;
    } catch (err) {
      if (err instanceof ConflictError) throw err;
      logger.warn('Redis L1 idempotency unavailable, falling back to PostgreSQL L2', {
        error: (err as Error).message,
      });
    }

    // 3. L2 Idempotency: Database Check
    const existingKeyRes = await pool.query(
      `SELECT * FROM idempotency_keys WHERE user_id = $1 AND key = $2;`,
      [input.userId, input.idempotencyKey]
    );

    if (existingKeyRes.rows.length > 0) {
      const existing = existingKeyRes.rows[0];

      if (acquiredRedisLock) {
        await redisClient.del(lockKey).catch(() => {});
      }

      if (existing.request_hash !== requestHash) {
        logger.warn('Idempotency mismatch for payment intent creation', {
          userId: input.userId,
          key: input.idempotencyKey,
        });
        throw new ConflictError(
          'Idempotency-Key has already been used with a different payment payload',
          'IDEMPOTENCY_PAYLOAD_MISMATCH'
        );
      }

      if (existing.status === 'COMPLETED' && existing.response_body) {
        logger.info('Replaying cached payment intent response from L2 store', {
          userId: input.userId,
          key: input.idempotencyKey,
        });
        return existing.response_body as PaymentIntentResponseDTO;
      }

      if (existing.status === 'IN_PROGRESS') {
        throw new ConflictError(
          'A payment intent with this Idempotency-Key is currently processing',
          'IDEMPOTENCY_IN_PROGRESS'
        );
      }
    }

    try {
      // 4. Create Order on Gateway Adapter
      const gateway = PaymentGatewayFactory.getGateway(input.provider);
      const receiptId = `rcpt_${Date.now()}_${input.idempotencyKey.slice(0, 8)}`;

      const orderResult = await gateway.createOrder({
        amount: input.amount,
        currency,
        receipt: receiptId,
        notes: {
          userId: input.userId,
          walletId: userWallet.id,
          idempotencyKey: input.idempotencyKey,
        },
      });

      // 5. Persist Payment Intent in PostgreSQL
      const intentEntity = await this.paymentRepo.createPaymentIntent({
        userId: input.userId,
        walletId: userWallet.id,
        amount: BigInt(input.amount),
        currency,
        provider: gateway.providerName,
        gatewayOrderId: orderResult.providerOrderId,
        status: 'CREATED',
        idempotencyKey: input.idempotencyKey,
        metadata: {
          clientSecret: orderResult.clientSecret,
          receipt: receiptId,
        },
      });

      const responseDTO = this.mapEntityToDTO(intentEntity, orderResult.clientSecret);

      // 6. Persist Idempotency Record
      await pool.query(
        `
        INSERT INTO idempotency_keys (
          user_id, key, request_path, request_hash, response_status, response_body, status, expires_at
        )
        VALUES ($1, $2, $3, $4, 201, $5, 'COMPLETED', NOW() + INTERVAL '24 hours')
        ON CONFLICT (user_id, key) DO UPDATE
        SET response_status = 201, response_body = $5, status = 'COMPLETED';
        `,
        [
          input.userId,
          input.idempotencyKey,
          '/api/v1/payments/intents',
          requestHash,
          JSON.stringify(responseDTO),
        ]
      );

      logger.info('Payment intent created successfully', {
        intentId: intentEntity.id,
        gatewayOrderId: orderResult.providerOrderId,
        amount: input.amount,
        userId: input.userId,
      });

      return responseDTO;
    } finally {
      if (acquiredRedisLock) {
        await redisClient.del(lockKey).catch(() => {});
      }
    }
  }

  async getPaymentIntent(
    userId: string,
    paymentIntentId: string,
    userRole: string
  ): Promise<PaymentIntentResponseDTO> {
    const intent = await this.paymentRepo.findPaymentIntentById(paymentIntentId);
    if (!intent) {
      throw new NotFoundError(
        `Payment intent with id ${paymentIntentId} not found`,
        'PAYMENT_INTENT_NOT_FOUND'
      );
    }

    // Role-based authorization check
    if (intent.userId !== userId && userRole !== 'ADMIN') {
      throw new ForbiddenError(
        'You are not authorized to view this payment intent',
        'FORBIDDEN_PAYMENT_ACCESS'
      );
    }

    return this.mapEntityToDTO(intent);
  }

  async listUserPayments(
    userId: string,
    query: ListPaymentIntentsQuery
  ): Promise<{
    payments: PaymentIntentResponseDTO[];
    pagination: { page: number; limit: number; total: number; totalPages: number };
  }> {
    const page = query.page || 1;
    const limit = query.limit || 20;

    const { items, total } = await this.paymentRepo.listPaymentIntentsByUser(
      userId,
      page,
      limit,
      query.status
    );

    return {
      payments: items.map((item) => this.mapEntityToDTO(item)),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  }

  async listAdminPayments(query: ListPaymentIntentsQuery): Promise<{
    payments: PaymentIntentResponseDTO[];
    pagination: { page: number; limit: number; total: number; totalPages: number };
  }> {
    const page = query.page || 1;
    const limit = query.limit || 20;

    const { items, total } = await this.paymentRepo.listAllPaymentIntents(
      page,
      limit,
      query.status
    );

    return {
      payments: items.map((item) => this.mapEntityToDTO(item)),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  }

  /**
   * Reconciliation audit utility: Compares PayFlow database intent state against
   * gateway external status and double-entry ledger settlement records.
   */
  async reconcilePayment(paymentIntentId: string): Promise<{
    paymentIntentId: string;
    internalStatus: string;
    gatewayStatus: string;
    isLedgerBalanced: boolean;
    isReconciled: boolean;
    discrepancies: string[];
  }> {
    const intent = await this.paymentRepo.findPaymentIntentById(paymentIntentId);
    if (!intent) {
      throw new NotFoundError(`Payment intent ${paymentIntentId} not found`);
    }

    const gateway = PaymentGatewayFactory.getGateway(intent.provider);
    const gatewayStatusResult = await gateway.getPaymentStatus(
      intent.gatewayOrderId,
      intent.gatewayPaymentId || undefined
    );

    const discrepancies: string[] = [];

    // Check transaction and ledger entries
    const txnRes = await pool.query(
      `SELECT id, status FROM transactions WHERE metadata->>'paymentIntentId' = $1;`,
      [intent.id]
    );

    let isLedgerBalanced = false;
    if (txnRes.rows.length > 0) {
      const txnId = txnRes.rows[0].id;
      const ledgerRes = await pool.query(
        `SELECT entry_type, SUM(amount) AS sum_amount FROM ledger_entries WHERE transaction_id = $1 GROUP BY entry_type;`,
        [txnId]
      );
      const debits = ledgerRes.rows.find((r) => r.entry_type === 'DEBIT')?.sum_amount || '0';
      const credits = ledgerRes.rows.find((r) => r.entry_type === 'CREDIT')?.sum_amount || '0';
      isLedgerBalanced = debits === credits && debits === intent.amount.toString();
    }

    if (intent.status === 'SUCCESS' && gatewayStatusResult.status !== 'SUCCESS') {
      discrepancies.push('PayFlow marked SUCCESS but gateway reports non-success status');
    }
    if (intent.status !== 'SUCCESS' && gatewayStatusResult.status === 'SUCCESS') {
      discrepancies.push('Gateway reports payment SUCCESS but PayFlow intent is not settled');
    }
    if (intent.status === 'SUCCESS' && !isLedgerBalanced) {
      discrepancies.push('Payment marked SUCCESS but ledger entries are missing or unbalanced');
    }

    return {
      paymentIntentId,
      internalStatus: intent.status,
      gatewayStatus: gatewayStatusResult.status,
      isLedgerBalanced,
      isReconciled: discrepancies.length === 0,
      discrepancies,
    };
  }
}

export const paymentService = new PaymentService();
