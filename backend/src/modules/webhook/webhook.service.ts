import crypto from 'crypto';
import { WebhookRepository } from './webhook.repository';
import { PaymentRepository } from '../payment/payment.repository';
import { PaymentGatewayFactory } from '../payment/gateway/paymentGateway.factory';
import { pool } from '../../database';
import { logger } from '../../config/logger';
import { BadRequestError, UnauthorizedError } from '../../utils/errors';

export class WebhookService {
  constructor(
    private webhookRepo: WebhookRepository = new WebhookRepository(),
    private paymentRepo: PaymentRepository = new PaymentRepository()
  ) {}

  async processWebhook(
    rawBody: Buffer | string,
    headers: Record<string, string | string[] | undefined>
  ): Promise<{
    received: boolean;
    status: string;
    transactionReference?: string;
    paymentIntentId?: string;
    message?: string;
  }> {
    if (!rawBody) {
      throw new BadRequestError('Raw webhook body is missing or empty', 'MISSING_RAW_BODY');
    }

    // 1. Identify provider
    const isRazorpay = Boolean(headers['x-razorpay-signature']);
    const providerHeader = (headers['x-gateway-provider'] as string) || (isRazorpay ? 'RAZORPAY' : 'MOCK_GATEWAY');
    const gateway = PaymentGatewayFactory.getGateway(providerHeader);

    // 2. Parse event and verify signature
    const event = gateway.parseWebhookEvent(rawBody, headers);

    if (!event.isValid) {
      logger.warn('Webhook rejected: Invalid cryptographic signature', {
        provider: gateway.providerName,
        eventId: event.gatewayEventId,
      });
      throw new UnauthorizedError(
        'Webhook signature verification failed',
        'INVALID_WEBHOOK_SIGNATURE'
      );
    }

    const rawBuf = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody, 'utf8');
    const payloadHash = crypto.createHash('sha256').update(rawBuf).digest('hex');

    // 3. Ingress Deduplication: Check if already processed
    const existingEvent = await this.webhookRepo.findEvent(
      gateway.providerName,
      event.gatewayEventId
    );

    if (existingEvent && existingEvent.isProcessed) {
      logger.info('Duplicate webhook detected; returning idempotent acknowledgment', {
        provider: gateway.providerName,
        eventId: event.gatewayEventId,
      });
      return {
        received: true,
        status: 'ALREADY_PROCESSED',
        message: 'Webhook previously processed and settled',
      };
    }

    // 4. Record event in webhook_events
    await this.webhookRepo.recordEvent({
      gatewayName: gateway.providerName,
      gatewayEventId: event.gatewayEventId,
      eventType: event.eventType,
      payload: (event.metadata as Record<string, unknown>) || {},
      payloadHash,
    });

    // 5. Look up target Payment Intent
    let intent = await this.paymentRepo.findPaymentIntentByOrderId(event.gatewayOrderId);
    if (!intent && event.gatewayPaymentId) {
      const res = await pool.query(
        'SELECT * FROM payment_intents WHERE gateway_payment_id = $1;',
        [event.gatewayPaymentId]
      );
      if (res.rowCount && res.rowCount > 0) {
        intent = (this.paymentRepo as any).mapRowToEntity(res.rows[0]);
      }
    }

    if (!intent) {
      logger.warn('Webhook received for unknown payment order', {
        orderId: event.gatewayOrderId,
        paymentId: event.gatewayPaymentId,
      });
      await this.webhookRepo.markProcessed(
        gateway.providerName,
        event.gatewayEventId,
        true,
        'Order not found in PayFlow database'
      );
      return { received: true, status: 'UNKNOWN_ORDER' };
    }

    // 6. Handle PAYMENT_SUCCESS: Atomic PostgreSQL Transaction
    if (event.eventType === 'PAYMENT_SUCCESS') {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // Pessimistically lock Payment Intent row
        const lockedIntent = await this.paymentRepo.findPaymentIntentByIdForUpdate(
          intent.gatewayOrderId,
          client
        );

        if (!lockedIntent) {
          await client.query('ROLLBACK');
          return { received: true, status: 'UNKNOWN_ORDER' };
        }

        // Check if intent is already settled (Terminal SUCCESS guard)
        if (lockedIntent.status === 'SUCCESS') {
          await client.query('COMMIT');
          await this.webhookRepo.markProcessed(
            gateway.providerName,
            event.gatewayEventId,
            true
          );
          return {
            received: true,
            status: 'ALREADY_SUCCESS',
            paymentIntentId: lockedIntent.id,
          };
        }

        // Pessimistically lock User Wallet
        const userWalletRes = await client.query(
          'SELECT * FROM wallets WHERE id = $1 FOR UPDATE;',
          [lockedIntent.walletId]
        );
        if (userWalletRes.rowCount === 0) {
          throw new Error(`User wallet ${lockedIntent.walletId} not found`);
        }
        const userWallet = userWalletRes.rows[0];

        // Pessimistically lock System Gateway Clearing Wallet
        const CLEARING_WALLET_ID = '00000000-0000-0000-0000-000000000001';
        const clearingWalletRes = await client.query(
          'SELECT * FROM wallets WHERE id = $1 FOR UPDATE;',
          [CLEARING_WALLET_ID]
        );
        if (clearingWalletRes.rowCount === 0) {
          throw new Error('System clearing wallet not found in database');
        }
        const clearingWallet = clearingWalletRes.rows[0];

        const depositAmount = lockedIntent.amount;
        const newUserBalance = BigInt(userWallet.balance) + depositAmount;
        const newClearingBalance = BigInt(clearingWallet.balance) - depositAmount;

        // A. Credit User Wallet
        await client.query(
          'UPDATE wallets SET balance = $1, version = version + 1, updated_at = NOW() WHERE id = $2;',
          [newUserBalance.toString(), userWallet.id]
        );

        // B. Update System Clearing Wallet
        await client.query(
          'UPDATE wallets SET balance = $1, version = version + 1, updated_at = NOW() WHERE id = $2;',
          [newClearingBalance.toString(), CLEARING_WALLET_ID]
        );

        // C. Record Financial Transaction (TOPUP)
        const txnRef = `TXN_TOPUP_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
        const txnRes = await client.query(
          `
          INSERT INTO transactions (
            reference_id, type, status, amount, currency, sender_wallet_id, receiver_wallet_id, metadata
          )
          VALUES ($1, 'TOPUP', 'COMPLETED', $2, $3, $4, $5, $6)
          RETURNING id;
          `,
          [
            txnRef,
            depositAmount.toString(),
            lockedIntent.currency,
            CLEARING_WALLET_ID,
            userWallet.id,
            JSON.stringify({
              paymentIntentId: lockedIntent.id,
              gatewayOrderId: lockedIntent.gatewayOrderId,
              gatewayPaymentId: event.gatewayPaymentId,
              provider: lockedIntent.provider,
            }),
          ]
        );
        const transactionId = txnRes.rows[0].id;

        // D. Record Double-Entry Ledger Entries (Strict Financial Immutability)
        // DEBIT SYSTEM_GATEWAY_CLEARING
        await client.query(
          `
          INSERT INTO ledger_entries (
            transaction_id, wallet_id, entry_type, amount, balance_after, description
          )
          VALUES ($1, $2, 'DEBIT', $3, $4, $5);
          `,
          [
            transactionId,
            CLEARING_WALLET_ID,
            depositAmount.toString(),
            newClearingBalance.toString(),
            `Gateway clearing settlement: ${lockedIntent.gatewayOrderId}`,
          ]
        );

        // CREDIT USER_WALLET
        await client.query(
          `
          INSERT INTO ledger_entries (
            transaction_id, wallet_id, entry_type, amount, balance_after, description
          )
          VALUES ($1, $2, 'CREDIT', $3, $4, $5);
          `,
          [
            transactionId,
            userWallet.id,
            depositAmount.toString(),
            newUserBalance.toString(),
            `Deposit via ${lockedIntent.provider}`,
          ]
        );

        // E. Record Transactional Outbox Event (Reliable Event Delivery)
        await client.query(
          `
          INSERT INTO outbox_events (
            aggregate_type, aggregate_id, event_type, payload, status
          )
          VALUES ('PAYMENT', $1, 'PAYMENT_SUCCEEDED', $2, 'PENDING');
          `,
          [
            lockedIntent.id,
            JSON.stringify({
              paymentIntentId: lockedIntent.id,
              transactionId,
              transactionReference: txnRef,
              userId: lockedIntent.userId,
              walletId: lockedIntent.walletId,
              amount: Number(depositAmount),
              currency: lockedIntent.currency,
              gatewayPaymentId: event.gatewayPaymentId,
            }),
          ]
        );

        // F. Update Payment Intent Status to SUCCESS
        await client.query(
          `
          UPDATE payment_intents
          SET
            status = 'SUCCESS',
            gateway_payment_id = COALESCE($1, gateway_payment_id),
            completed_at = NOW(),
            updated_at = NOW()
          WHERE id = $2;
          `,
          [event.gatewayPaymentId || null, lockedIntent.id]
        );

        // G. Mark Webhook as Processed
        await client.query(
          `
          UPDATE webhook_events
          SET is_processed = true, processed_at = NOW()
          WHERE gateway_name = $1 AND gateway_event_id = $2;
          `,
          [gateway.providerName, event.gatewayEventId]
        );

        await client.query('COMMIT');

        logger.info('Payment intent settled and wallet credited successfully', {
          paymentIntentId: lockedIntent.id,
          userId: lockedIntent.userId,
          amount: depositAmount.toString(),
          transactionReference: txnRef,
        });

        return {
          received: true,
          status: 'SETTLED',
          transactionReference: txnRef,
          paymentIntentId: lockedIntent.id,
        };
      } catch (err) {
        await client.query('ROLLBACK');
        logger.error('Failed to settle payment intent via webhook, rolled back', {
          error: (err as Error).message,
        });
        throw err;
      } finally {
        client.release();
      }
    }

    // 7. Handle PAYMENT_FAILED
    if (event.eventType === 'PAYMENT_FAILED') {
      await this.paymentRepo.updatePaymentIntentStatus(intent.id, 'FAILED', {
        gatewayPaymentId: event.gatewayPaymentId,
        errorMessage: event.failureReason || 'Payment failed at external gateway',
      });
      await this.webhookRepo.markProcessed(gateway.providerName, event.gatewayEventId, true);
      return { received: true, status: 'MARKED_FAILED', paymentIntentId: intent.id };
    }

    // 8. Handle PAYMENT_CANCELLED
    if (event.eventType === 'PAYMENT_CANCELLED') {
      await this.paymentRepo.updatePaymentIntentStatus(intent.id, 'CANCELLED', {
        errorMessage: 'Payment cancelled by customer',
      });
      await this.webhookRepo.markProcessed(gateway.providerName, event.gatewayEventId, true);
      return { received: true, status: 'MARKED_CANCELLED', paymentIntentId: intent.id };
    }

    return { received: true, status: 'IGNORED_EVENT_TYPE' };
  }
}

export const webhookService = new WebhookService();
