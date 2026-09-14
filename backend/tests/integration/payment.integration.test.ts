import request from 'supertest';
import { createApp } from '../../src/app';
import { getClient } from '../../src/database';
import { userRepository } from '../../src/modules/user/user.repository';
import { walletService } from '../../src/modules/wallet/wallet.service';
import { generateAccessToken } from '../../src/utils/token';
import { MockPaymentGatewayAdapter } from '../../src/modules/payment/gateway/mockPaymentGateway.adapter';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';

describe('Payment API Endpoints & State Machine Integration Tests', () => {
  const app = createApp();
  const mockAdapter = new MockPaymentGatewayAdapter('dev_mock_webhook_secret_for_testing_purposes');

  let testUserId: string;
  let testUserToken: string;
  let otherUserId: string;
  let otherUserToken: string;

  beforeAll(async () => {
    const passwordHash = await bcrypt.hash('TestPass123', 10);

    // Primary test user
    const user = await userRepository.createUser({
      email: `payment_test_${Date.now()}@payflow.internal`,
      passwordHash,
      fullName: 'Payment Test User',
      role: 'USER',
    });
    testUserId = user.id;
    testUserToken = generateAccessToken({ userId: user.id, email: user.email, role: 'USER' });
    await walletService.getOrCreateUserWallet(testUserId);

    // Second user for cross-user authorization tests
    const otherUser = await userRepository.createUser({
      email: `payment_other_${Date.now()}@payflow.internal`,
      passwordHash,
      fullName: 'Other Test User',
      role: 'USER',
    });
    otherUserId = otherUser.id;
    otherUserToken = generateAccessToken({ userId: otherUser.id, email: otherUser.email, role: 'USER' });
    await walletService.getOrCreateUserWallet(otherUserId);
  }, 25000);

  afterAll(async () => {
    try {
      const client = await getClient();
      try {
        if (testUserId) {
          await client.query('DELETE FROM users WHERE id = $1', [testUserId]);
        }
        if (otherUserId) {
          await client.query('DELETE FROM users WHERE id = $1', [otherUserId]);
        }
      } finally {
        client.release();
      }
    } catch {
      // Ignore test cleanup errors
    }
  });

  describe('1. Authentication & Request Validation Guards', () => {
    it('should reject payment intent creation when no auth token is provided (401)', async () => {
      const res = await request(app)
        .post('/api/v1/payments/intents')
        .send({ amount: 10000, currency: 'INR' });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('should reject payment intent creation without Idempotency-Key header (400)', async () => {
      const res = await request(app)
        .post('/api/v1/payments/intents')
        .set('Authorization', `Bearer ${testUserToken}`)
        .send({ amount: 10000, currency: 'INR' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('MISSING_IDEMPOTENCY_KEY');
    });

    it('should reject invalid non-integer or zero amounts (400)', async () => {
      const res = await request(app)
        .post('/api/v1/payments/intents')
        .set('Authorization', `Bearer ${testUserToken}`)
        .set('Idempotency-Key', uuidv4())
        .send({ amount: 0, currency: 'INR' });

      expect(res.status).toBe(400);
    });

    it('should reject amounts below minimum 100 paise (400)', async () => {
      const res = await request(app)
        .post('/api/v1/payments/intents')
        .set('Authorization', `Bearer ${testUserToken}`)
        .set('Idempotency-Key', uuidv4())
        .send({ amount: 50, currency: 'INR' });

      expect(res.status).toBe(400);
    });
  });

  describe('2. Payment Intent Creation & Idempotency', () => {
    const idempotencyKey = uuidv4();
    let createdIntentId: string;
    let gatewayOrderId: string;

    it('should successfully create a payment intent with MOCK_GATEWAY order (201)', async () => {
      const res = await request(app)
        .post('/api/v1/payments/intents')
        .set('Authorization', `Bearer ${testUserToken}`)
        .set('Idempotency-Key', idempotencyKey)
        .send({ amount: 100000, currency: 'INR', provider: 'MOCK_GATEWAY' });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('id');
      expect(res.body.data.amount).toBe(100000);
      expect(res.body.data.status).toBe('CREATED');
      expect(res.body.data.gatewayOrderId).toMatch(/^order_mock_/);
      expect(res.body.data.userId).toBe(testUserId);

      createdIntentId = res.body.data.id;
      gatewayOrderId = res.body.data.gatewayOrderId;
    });

    it('should return identical intent when re-submitting with the same Idempotency-Key', async () => {
      const res = await request(app)
        .post('/api/v1/payments/intents')
        .set('Authorization', `Bearer ${testUserToken}`)
        .set('Idempotency-Key', idempotencyKey)
        .send({ amount: 100000, currency: 'INR', provider: 'MOCK_GATEWAY' });

      expect(res.status).toBe(201);
      expect(res.body.data.id).toBe(createdIntentId);
      expect(res.body.data.gatewayOrderId).toBe(gatewayOrderId);
    });

    it('should fetch payment intent by ID for the owning user (200)', async () => {
      const res = await request(app)
        .get(`/api/v1/payments/${createdIntentId}`)
        .set('Authorization', `Bearer ${testUserToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(createdIntentId);
      expect(res.body.data.status).toBe('CREATED');
    });

    it('should prevent cross-user access to payment intent (403 Forbidden)', async () => {
      const res = await request(app)
        .get(`/api/v1/payments/${createdIntentId}`)
        .set('Authorization', `Bearer ${otherUserToken}`);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN_PAYMENT_ACCESS');
    });

    it('should list user payments including the newly created intent (200)', async () => {
      const res = await request(app)
        .get('/api/v1/payments')
        .set('Authorization', `Bearer ${testUserToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data.payments)).toBe(true);
      const found = res.body.data.payments.some((p: any) => p.id === createdIntentId);
      expect(found).toBe(true);
    });
  });

  describe('3. End-to-End Payment Settlement & Status Transition', () => {
    it(
      'should settle the payment intent via mock webhook and reflect in GET /api/v1/payments/:id',
      async () => {
      // 1. Create fresh intent
      const intentRes = await request(app)
        .post('/api/v1/payments/intents')
        .set('Authorization', `Bearer ${testUserToken}`)
        .set('Idempotency-Key', uuidv4())
        .send({ amount: 250000, currency: 'INR', provider: 'MOCK_GATEWAY' });

      expect(intentRes.status).toBe(201);
      const freshIntent = intentRes.body.data;
      const orderId = freshIntent.gatewayOrderId;

      const walletBefore = await walletService.getWalletByUserId(testUserId);
      const balanceBefore = BigInt(walletBefore.balance);

      // 2. Simulate Webhook
      const paymentId = `pay_mock_${Date.now()}`;
      const payload = {
        event: 'payment.captured',
        id: `evt_${Date.now()}`,
        payload: {
          payment: {
            entity: {
              id: paymentId,
              order_id: orderId,
              amount: 250000,
              currency: 'INR',
            },
          },
        },
      };
      const rawPayload = JSON.stringify(payload);
      const sig = mockAdapter.generateSignature(rawPayload);

      const webhookRes = await request(app)
        .post('/api/v1/webhooks/payment-gateway')
        .set('Content-Type', 'application/json')
        .set('x-mock-signature', sig)
        .send(payload);

      expect(webhookRes.status).toBe(200);
      expect(webhookRes.body.data.status).toBe('SETTLED');

      // 3. Verify Payment Status transition via GET /api/v1/payments/:paymentIntentId
      const checkRes = await request(app)
        .get(`/api/v1/payments/${freshIntent.id}`)
        .set('Authorization', `Bearer ${testUserToken}`);

      expect(checkRes.status).toBe(200);
      expect(checkRes.body.data.status).toBe('SUCCESS');
      expect(checkRes.body.data.gatewayPaymentId).toBe(paymentId);

      // 4. Verify Wallet Credited exactly once
      const walletAfter = await walletService.getWalletByUserId(testUserId);
      expect(BigInt(walletAfter.balance)).toBe(balanceBefore + BigInt(250000));
    }, 30000);
  });
});
