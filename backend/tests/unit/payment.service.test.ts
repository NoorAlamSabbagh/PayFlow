import { PaymentService } from '../../src/modules/payment/payment.service';
import { PaymentRepository } from '../../src/modules/payment/payment.repository';
import { WalletService } from '../../src/modules/wallet/wallet.service';
import { MockPaymentGatewayAdapter } from '../../src/modules/payment/gateway/mockPaymentGateway.adapter';
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from '../../src/utils/errors';
import { PaymentIntentEntity } from '../../src/modules/payment/payment.types';

// Mock dependencies
jest.mock('../../src/database', () => ({
  pool: {
    query: jest.fn(),
  },
}));

jest.mock('../../src/config/redis', () => ({
  redisClient: {
    set: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
  },
}));

describe('PaymentService & Gateway Unit Tests', () => {
  let paymentService: PaymentService;
  let mockPaymentRepo: jest.Mocked<PaymentRepository>;
  let mockWalletService: jest.Mocked<WalletService>;
  const mockPool = require('../../src/database').pool;

  const sampleUserId = '11111111-1111-1111-1111-111111111111';
  const sampleWalletId = '22222222-2222-2222-2222-222222222222';
  const sampleIntentId = '33333333-3333-3333-3333-333333333333';

  const sampleIntent: PaymentIntentEntity = {
    id: sampleIntentId,
    userId: sampleUserId,
    walletId: sampleWalletId,
    amount: BigInt(50000), // ₹500.00
    currency: 'INR',
    provider: 'MOCK_GATEWAY',
    gatewayOrderId: 'order_mock_test_12345',
    gatewayPaymentId: null,
    status: 'CREATED',
    idempotencyKey: 'test-idemp-key-1',
    errorMessage: null,
    metadata: { clientSecret: 'mock_secret_abc' },
    createdAt: new Date(),
    updatedAt: new Date(),
    completedAt: null,
  };

  beforeEach(() => {
    jest.clearAllMocks();

    mockPaymentRepo = {
      createPaymentIntent: jest.fn().mockResolvedValue(sampleIntent),
      findPaymentIntentById: jest.fn().mockResolvedValue(sampleIntent),
      findPaymentIntentByOrderId: jest.fn().mockResolvedValue(sampleIntent),
      findPaymentIntentByIdForUpdate: jest.fn().mockResolvedValue(sampleIntent),
      findPaymentIntentByIdempotency: jest.fn().mockResolvedValue(null),
      updatePaymentIntentStatus: jest.fn().mockResolvedValue(sampleIntent),
      listPaymentIntentsByUser: jest.fn().mockResolvedValue({ items: [sampleIntent], total: 1 }),
      listAllPaymentIntents: jest.fn().mockResolvedValue({ items: [sampleIntent], total: 1 }),
    } as unknown as jest.Mocked<PaymentRepository>;

    mockWalletService = {
      getOrCreateUserWallet: jest.fn().mockResolvedValue({
        id: sampleWalletId,
        user_id: sampleUserId,
        type: 'USER',
        currency: 'INR',
        balance: '100000',
        status: 'ACTIVE',
      }),
    } as unknown as jest.Mocked<WalletService>;

    mockPool.query.mockResolvedValue({ rows: [] });

    paymentService = new PaymentService(mockPaymentRepo, mockWalletService);
  });

  describe('createPaymentIntent', () => {
    it('should successfully create a payment intent with CREATED status without crediting wallet', async () => {
      const result = await paymentService.createPaymentIntent({
        userId: sampleUserId,
        amount: 50000,
        currency: 'INR',
        idempotencyKey: 'test-idemp-key-1',
        provider: 'MOCK_GATEWAY',
      });

      expect(result.id).toBe(sampleIntentId);
      expect(result.status).toBe('CREATED');
      expect(result.amount).toBe(50000);
      expect(result.currency).toBe('INR');
      expect(result.gatewayOrderId).toBe('order_mock_test_12345');
      expect(mockPaymentRepo.createPaymentIntent).toHaveBeenCalledTimes(1);
    });

    it('should reject non-integer amount with BadRequestError', async () => {
      await expect(
        paymentService.createPaymentIntent({
          userId: sampleUserId,
          amount: 50.75, // float amount
          currency: 'INR',
          idempotencyKey: 'test-idemp-key-2',
        })
      ).rejects.toThrow(BadRequestError);
    });

    it('should reject non-positive amount with BadRequestError', async () => {
      await expect(
        paymentService.createPaymentIntent({
          userId: sampleUserId,
          amount: -100,
          currency: 'INR',
          idempotencyKey: 'test-idemp-key-3',
        })
      ).rejects.toThrow(BadRequestError);
    });

    it('should reject missing idempotency key with BadRequestError', async () => {
      await expect(
        paymentService.createPaymentIntent({
          userId: sampleUserId,
          amount: 10000,
          currency: 'INR',
          idempotencyKey: '',
        })
      ).rejects.toThrow(BadRequestError);
    });

    it('should throw ConflictError on idempotency payload mismatch (same key, different amount)', async () => {
      // Simulate stored idempotency key with different request hash
      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            key: 'test-idemp-key-1',
            request_hash: 'different_hash_from_another_amount',
            status: 'COMPLETED',
            response_body: { id: sampleIntentId, amount: 20000 },
          },
        ],
      });

      await expect(
        paymentService.createPaymentIntent({
          userId: sampleUserId,
          amount: 50000,
          currency: 'INR',
          idempotencyKey: 'test-idemp-key-1',
        })
      ).rejects.toThrow(ConflictError);
    });

    it('should replay cached response when exact same idempotency key and payload are submitted', async () => {
      const crypto = require('crypto');
      const canonical = JSON.stringify({
        userId: sampleUserId,
        amount: 50000,
        currency: 'INR',
      });
      const validHash = crypto.createHash('sha256').update(canonical).digest('hex');

      const cachedDTO = {
        id: sampleIntentId,
        userId: sampleUserId,
        walletId: sampleWalletId,
        amount: 50000,
        currency: 'INR',
        provider: 'MOCK_GATEWAY',
        gatewayOrderId: 'order_mock_test_12345',
        gatewayPaymentId: null,
        status: 'CREATED',
        errorMessage: null,
        createdAt: new Date().toISOString(),
        completedAt: null,
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            key: 'test-idemp-key-1',
            request_hash: validHash,
            status: 'COMPLETED',
            response_body: cachedDTO,
          },
        ],
      });

      const result = await paymentService.createPaymentIntent({
        userId: sampleUserId,
        amount: 50000,
        currency: 'INR',
        idempotencyKey: 'test-idemp-key-1',
      });

      expect(result).toEqual(cachedDTO);
      expect(mockPaymentRepo.createPaymentIntent).not.toHaveBeenCalled();
    });
  });

  describe('getPaymentIntent Authorization', () => {
    it('should allow user to view their own payment intent', async () => {
      const result = await paymentService.getPaymentIntent(
        sampleUserId,
        sampleIntentId,
        'USER'
      );
      expect(result.id).toBe(sampleIntentId);
    });

    it('should throw ForbiddenError when User B attempts to access User A payment intent', async () => {
      const otherUserId = '99999999-9999-9999-9999-999999999999';
      await expect(
        paymentService.getPaymentIntent(otherUserId, sampleIntentId, 'USER')
      ).rejects.toThrow(ForbiddenError);
    });

    it('should allow ADMIN to access any user payment intent', async () => {
      const adminUserId = 'admin-uuid-0000';
      const result = await paymentService.getPaymentIntent(
        adminUserId,
        sampleIntentId,
        'ADMIN'
      );
      expect(result.id).toBe(sampleIntentId);
    });

    it('should throw NotFoundError if payment intent does not exist', async () => {
      mockPaymentRepo.findPaymentIntentById.mockResolvedValueOnce(null);
      await expect(
        paymentService.getPaymentIntent(sampleUserId, 'non-existent-id', 'USER')
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe('MockPaymentGatewayAdapter Cryptographic Verification', () => {
    const adapter = new MockPaymentGatewayAdapter('test_secret_123');

    it('should generate valid HMAC-SHA256 signature and verify successfully', () => {
      const payload = JSON.stringify({
        event: 'payment.captured',
        id: 'evt_123',
        amount: 50000,
      });
      const sig = adapter.generateSignature(payload, 'test_secret_123');

      const isValid = adapter.verifyWebhookSignature(payload, sig, 'test_secret_123');
      expect(isValid).toBe(true);
    });

    it('should reject forged or tampered webhook signature', () => {
      const payload = JSON.stringify({ event: 'payment.captured', amount: 50000 });
      const forgedSig = 'a1b2c3d4e5f60000000000000000000000000000000000000000000000000000';

      const isValid = adapter.verifyWebhookSignature(payload, forgedSig, 'test_secret_123');
      expect(isValid).toBe(false);
    });

    it('should accurately parse PAYMENT_SUCCESS event', () => {
      const payload = JSON.stringify({
        event: 'payment.captured',
        id: 'evt_test_101',
        payload: {
          payment: {
            entity: {
              id: 'pay_test_999',
              order_id: 'order_mock_test_12345',
              amount: 50000,
              currency: 'INR',
            },
          },
        },
      });
      const sig = adapter.generateSignature(payload, 'test_secret_123');

      const result = adapter.parseWebhookEvent(payload, {
        'x-mock-signature': sig,
      });

      expect(result.isValid).toBe(true);
      expect(result.eventType).toBe('PAYMENT_SUCCESS');
      expect(result.gatewayOrderId).toBe('order_mock_test_12345');
      expect(result.gatewayPaymentId).toBe('pay_test_999');
      expect(result.amount).toBe(50000);
    });
  });
});