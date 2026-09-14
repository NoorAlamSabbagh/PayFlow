import request from 'supertest';
import { createApp } from '../../src/app';
import { getClient } from '../../src/database';
import { userRepository } from '../../src/modules/user/user.repository';
import { walletService } from '../../src/modules/wallet/wallet.service';
import { MockPaymentGatewayAdapter } from '../../src/modules/payment/gateway/mockPaymentGateway.adapter';
import bcrypt from 'bcryptjs';

describe('Authoritative Payment Gateway Webhook Integration Tests', () => {
  const app = createApp();
  const mockAdapter = new MockPaymentGatewayAdapter('dev_mock_webhook_secret_for_testing_purposes');
  let testUserId: string;
  let testWalletId: string;
  const initialDepositPaise = 100000; // ₹1,000.00

  beforeAll(async () => {
    // 1. Provision dedicated test user and wallet
    const passwordHash = await bcrypt.hash('TestPass123', 10);
    const user = await userRepository.createUser({
      email: `webhook_user_${Date.now()}@payflow.internal`,
      passwordHash,
      fullName: 'Webhook Test User',
      role: 'USER',
    });
    testUserId = user.id;

    const wallet = await walletService.getOrCreateUserWallet(testUserId);
    testWalletId = wallet.id;
  }, 25000);

  afterAll(async () => {
    if (testUserId) {
      try {
        const client = await getClient();
        try {
          await client.query('DELETE FROM users WHERE id = $1', [testUserId]);
        } finally {
          client.release();
        }
      } catch {
        // Ignore test cleanup errors
      }
    }
  });

  describe('1. Webhook Signature Verification Security Guard', () => {
    it('should reject webhook with 401 Unauthorized when signature is forged or invalid', async () => {
      const payload = {
        event: 'payment.captured',
        id: `evt_forged_${Date.now()}`,
        payload: {
          payment: {
            entity: {
              id: 'pay_fake_001',
              order_id: 'order_fake_001',
              amount: 50000,
            },
          },
        },
      };

      const res = await request(app)
        .post('/api/v1/webhooks/payment-gateway')
        .set('Content-Type', 'application/json')
        .set('x-mock-signature', 'forged_invalid_hex_signature_32byteslength000000000000000000000000')
        .send(payload);

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INVALID_WEBHOOK_SIGNATURE');
    });
  });

  describe('2. Authoritative Settlement Workflow (PAYMENT_SUCCESS)', () => {
    it(
      'should atomically transition intent to SUCCESS, credit wallet, post double-entry ledger & queue outbox',
      async () => {
      const client = await getClient();
      const gatewayOrderId = `order_test_${Date.now()}`;
      let intentId: string;

      try {
        // Pre-create payment intent in CREATED status
        const intentRes = await client.query(
          `
          INSERT INTO payment_intents (
            user_id, wallet_id, amount, currency, provider, gateway_order_id, status
          )
          VALUES ($1, $2, $3, 'INR', 'MOCK_GATEWAY', $4, 'CREATED')
          RETURNING id;
          `,
          [testUserId, testWalletId, initialDepositPaise.toString(), gatewayOrderId]
        );
        intentId = intentRes.rows[0].id;
      } finally {
        client.release();
      }

      // Check wallet balance prior to webhook
      const walletBefore = await walletService.getWalletByUserId(testUserId);
      const balanceBefore = BigInt(walletBefore.balance);

      const gatewayEventId = `evt_settle_${Date.now()}`;
      const payload = {
        event: 'payment.captured',
        id: gatewayEventId,
        payload: {
          payment: {
            entity: {
              id: `pay_${Date.now()}`,
              order_id: gatewayOrderId,
              amount: initialDepositPaise,
              currency: 'INR',
            },
          },
        },
      };
      const rawPayloadStr = JSON.stringify(payload);
      const validSig = mockAdapter.generateSignature(rawPayloadStr);

      const res = await request(app)
        .post('/api/v1/webhooks/payment-gateway')
        .set('Content-Type', 'application/json')
        .set('x-mock-signature', validSig)
        .send(payload);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('SETTLED');

      // Verify DB State
      const verifyClient = await getClient();
      try {
        // 1. Payment Intent is SUCCESS
        const piCheck = await verifyClient.query(
          'SELECT status, gateway_payment_id, completed_at FROM payment_intents WHERE id = $1;',
          [intentId]
        );
        expect(piCheck.rows[0].status).toBe('SUCCESS');
        expect(piCheck.rows[0].completed_at).not.toBeNull();

        // 2. User Wallet credited
        const walletAfter = await walletService.getWalletByUserId(testUserId);
        const balanceAfter = BigInt(walletAfter.balance);
        expect(balanceAfter - balanceBefore).toBe(BigInt(initialDepositPaise));

        // 3. Double-entry Ledger entries recorded
        const ledgerRes = await verifyClient.query(
          'SELECT * FROM ledger_entries WHERE wallet_id = $1 ORDER BY created_at DESC LIMIT 1;',
          [testWalletId]
        );
        expect(ledgerRes.rows.length).toBe(1);
        expect(ledgerRes.rows[0].entry_type).toBe('CREDIT');
        expect(ledgerRes.rows[0].amount).toBe(initialDepositPaise.toString());

        // 4. Outbox event recorded
        const outboxRes = await verifyClient.query(
          "SELECT * FROM outbox_events WHERE aggregate_id = $1 AND event_type = 'PAYMENT_SUCCEEDED';",
          [intentId]
        );
        expect(outboxRes.rows.length).toBe(1);
      } finally {
        verifyClient.release();
      }
    }, 25000);
  });

  describe('3. Webhook Ingress Deduplication (Replay Protection)', () => {
    it(
      'should ignore duplicate webhook and return idempotent 200 without crediting wallet twice',
      async () => {
      const client = await getClient();
      const gatewayOrderId = `order_dedup_${Date.now()}`;
      const duplicateAmount = 50000; // ₹500

      try {
        await client.query(
          `
          INSERT INTO payment_intents (
            user_id, wallet_id, amount, currency, provider, gateway_order_id, status
          )
          VALUES ($1, $2, $3, 'INR', 'MOCK_GATEWAY', $4, 'CREATED');
          `,
          [testUserId, testWalletId, duplicateAmount.toString(), gatewayOrderId]
        );
      } finally {
        client.release();
      }

      const walletBefore = await walletService.getWalletByUserId(testUserId);
      const balanceBefore = BigInt(walletBefore.balance);

      const dedupeEventId = `evt_dedup_${Date.now()}`;
      const payload = {
        event: 'payment.captured',
        id: dedupeEventId,
        payload: {
          payment: {
            entity: {
              id: `pay_dedup_${Date.now()}`,
              order_id: gatewayOrderId,
              amount: duplicateAmount,
              currency: 'INR',
            },
          },
        },
      };
      const rawPayloadStr = JSON.stringify(payload);
      const validSig = mockAdapter.generateSignature(rawPayloadStr);

      // Webhook Delivery 1 (First attempt)
      const res1 = await request(app)
        .post('/api/v1/webhooks/payment-gateway')
        .set('Content-Type', 'application/json')
        .set('x-mock-signature', validSig)
        .send(payload);

      expect(res1.status).toBe(200);
      expect(res1.body.data.status).toBe('SETTLED');

      const walletAfterFirst = await walletService.getWalletByUserId(testUserId);
      expect(BigInt(walletAfterFirst.balance) - balanceBefore).toBe(BigInt(duplicateAmount));

      // Webhook Delivery 2 (Duplicate retry)
      const res2 = await request(app)
        .post('/api/v1/webhooks/payment-gateway')
        .set('Content-Type', 'application/json')
        .set('x-mock-signature', validSig)
        .send(payload);

      expect(res2.status).toBe(200);
      expect(res2.body.data.status).toBe('ALREADY_PROCESSED');

      // Webhook Delivery 3 (Third retry)
      const res3 = await request(app)
        .post('/api/v1/webhooks/payment-gateway')
        .set('Content-Type', 'application/json')
        .set('x-mock-signature', validSig)
        .send(payload);

      expect(res3.status).toBe(200);
      expect(res3.body.data.status).toBe('ALREADY_PROCESSED');

      // Crucial: Wallet balance MUST REMAIN unchanged between delivery 1, 2 and 3!
      const walletFinal = await walletService.getWalletByUserId(testUserId);
      expect(walletFinal.balance).toBe(walletAfterFirst.balance);
    }, 25000);
  });

  describe('4. Failed Payment Webhook Handling (PAYMENT_FAILED)', () => {
    it('should transition intent to FAILED and leave user wallet balance unchanged', async () => {
      const client = await getClient();
      const gatewayOrderId = `order_fail_${Date.now()}`;
      let intentId: string;

      try {
        const intentRes = await client.query(
          `
          INSERT INTO payment_intents (
            user_id, wallet_id, amount, currency, provider, gateway_order_id, status
          )
          VALUES ($1, $2, 25000, 'INR', 'MOCK_GATEWAY', $3, 'CREATED')
          RETURNING id;
          `,
          [testUserId, testWalletId, gatewayOrderId]
        );
        intentId = intentRes.rows[0].id;
      } finally {
        client.release();
      }

      const walletBefore = await walletService.getWalletByUserId(testUserId);

      const payload = {
        event: 'payment.failed',
        id: `evt_fail_${Date.now()}`,
        payload: {
          payment: {
            entity: {
              id: `pay_failed_${Date.now()}`,
              order_id: gatewayOrderId,
              amount: 25000,
              error_description: 'Card declined by issuing bank',
            },
          },
        },
      };
      const rawPayloadStr = JSON.stringify(payload);
      const validSig = mockAdapter.generateSignature(rawPayloadStr);

      const res = await request(app)
        .post('/api/v1/webhooks/payment-gateway')
        .set('Content-Type', 'application/json')
        .set('x-mock-signature', validSig)
        .send(payload);

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('MARKED_FAILED');

      const checkClient = await getClient();
      try {
        const piCheck = await checkClient.query(
          'SELECT status, error_message FROM payment_intents WHERE id = $1;',
          [intentId]
        );
        expect(piCheck.rows[0].status).toBe('FAILED');
        expect(piCheck.rows[0].error_message).toBe('Card declined by issuing bank');
      } finally {
        checkClient.release();
      }

      // Wallet balance must be strictly identical
      const walletAfter = await walletService.getWalletByUserId(testUserId);
      expect(walletAfter.balance).toBe(walletBefore.balance);
    });
  });

  describe('5. Unknown Order Handling', () => {
    it('should safely acknowledge webhook for unknown order without throwing or mutating wallets', async () => {
      const payload = {
        event: 'payment.captured',
        id: `evt_unknown_${Date.now()}`,
        payload: {
          payment: {
            entity: {
              id: `pay_unknown_${Date.now()}`,
              order_id: 'order_non_existent_999999',
              amount: 50000,
            },
          },
        },
      };
      const rawPayloadStr = JSON.stringify(payload);
      const validSig = mockAdapter.generateSignature(rawPayloadStr);

      const res = await request(app)
        .post('/api/v1/webhooks/payment-gateway')
        .set('Content-Type', 'application/json')
        .set('x-mock-signature', validSig)
        .send(payload);

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('UNKNOWN_ORDER');
    });
  });
});
