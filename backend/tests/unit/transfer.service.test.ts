import { TransferService } from '../../src/modules/transfer/transfer.service';
import { TransferRepository } from '../../src/modules/transfer/transfer.repository';
import { WalletRepository } from '../../src/modules/wallet/wallet.repository';
import { WalletService } from '../../src/modules/wallet/wallet.service';
import { LedgerService } from '../../src/modules/ledger/ledger.service';
import { UserRepository } from '../../src/modules/user/user.repository';
import { BadRequestError, ConflictError, NotFoundError, ForbiddenError } from '../../src/utils/errors';

describe('TransferService Unit Tests', () => {
  let transferService: TransferService;
  let mockTransferRepo: jest.Mocked<TransferRepository>;
  let mockWalletRepo: jest.Mocked<WalletRepository>;
  let mockWalletServ: jest.Mocked<WalletService>;
  let mockLedgerServ: jest.Mocked<LedgerService>;
  let mockUserRepo: jest.Mocked<UserRepository>;

  beforeEach(() => {
    mockTransferRepo = {
      findIdempotencyKey: jest.fn(),
      saveIdempotencyKey: jest.fn(),
      createOutboxEvent: jest.fn(),
      findTransactionById: jest.fn(),
      findTransactionsByWalletId: jest.fn(),
    } as unknown as jest.Mocked<TransferRepository>;

    mockWalletRepo = {
      findByUserId: jest.fn(),
      findById: jest.fn(),
      createWallet: jest.fn(),
      findAndLockWallets: jest.fn(),
      updateBalance: jest.fn(),
    } as unknown as jest.Mocked<WalletRepository>;

    mockWalletServ = {
      getOrCreateUserWallet: jest.fn(),
      getWalletByUserId: jest.fn(),
      deposit: jest.fn(),
      getUserLedger: jest.fn(),
    } as unknown as jest.Mocked<WalletService>;

    mockLedgerServ = {
      postDoubleEntryTransaction: jest.fn(),
      getWalletLedgerHistory: jest.fn(),
    } as unknown as jest.Mocked<LedgerService>;

    mockUserRepo = {
      findByEmail: jest.fn(),
      findById: jest.fn(),
      createUser: jest.fn(),
    } as unknown as jest.Mocked<UserRepository>;

    transferService = new TransferService(
      mockTransferRepo,
      mockWalletRepo,
      mockWalletServ,
      mockLedgerServ,
      mockUserRepo
    );
  });

  describe('Validation & Edge Case Guards', () => {
    it('should reject non-positive amounts with BadRequestError', async () => {
      await expect(
        transferService.executeTransfer('user-1', {
          recipientId: 'user-2',
          amount: 0,
          currency: 'INR',
          idempotencyKey: 'key-12345678',
        })
      ).rejects.toThrow(BadRequestError);

      await expect(
        transferService.executeTransfer('user-1', {
          recipientId: 'user-2',
          amount: -500,
          currency: 'INR',
          idempotencyKey: 'key-12345678',
        })
      ).rejects.toThrow('Transfer amount must be strictly greater than 0 paise');
    });

    it('should reject self-transfers with BadRequestError', async () => {
      await expect(
        transferService.executeTransfer('user-1', {
          recipientId: 'user-1',
          amount: 5000,
          currency: 'INR',
          idempotencyKey: 'key-12345678',
        })
      ).rejects.toThrow('Self-transfer is prohibited. Sender and recipient must be distinct');
    });

    it('should reject transfer when recipient user does not exist', async () => {
      mockUserRepo.findById.mockResolvedValueOnce(null);

      await expect(
        transferService.executeTransfer('user-1', {
          recipientId: 'missing-user',
          amount: 5000,
          currency: 'INR',
          idempotencyKey: 'key-12345678',
        })
      ).rejects.toThrow(NotFoundError);
    });

    it('should reject transfer when sender user is deactivated', async () => {
      mockUserRepo.findById
        .mockResolvedValueOnce({
          id: 'user-2',
          email: 'recipient@test.com',
          password_hash: 'hash',
          full_name: 'Bob',
          role: 'USER',
          is_active: true,
          created_at: new Date(),
          updated_at: new Date(),
        })
        .mockResolvedValueOnce({
          id: 'user-1',
          email: 'sender@test.com',
          password_hash: 'hash',
          full_name: 'Alice',
          role: 'USER',
          is_active: false, // Suspended
          created_at: new Date(),
          updated_at: new Date(),
        });

      await expect(
        transferService.executeTransfer('user-1', {
          recipientId: 'user-2',
          amount: 5000,
          currency: 'INR',
          idempotencyKey: 'key-12345678',
        })
      ).rejects.toThrow(ForbiddenError);
    });

    it('should detect idempotency payload mismatch and reject with ConflictError (409)', async () => {
      mockUserRepo.findById
        .mockResolvedValueOnce({
          id: 'user-2',
          email: 'bob@test.com',
          password_hash: 'hash',
          full_name: 'Bob',
          role: 'USER',
          is_active: true,
          created_at: new Date(),
          updated_at: new Date(),
        })
        .mockResolvedValueOnce({
          id: 'user-1',
          email: 'alice@test.com',
          password_hash: 'hash',
          full_name: 'Alice',
          role: 'USER',
          is_active: true,
          created_at: new Date(),
          updated_at: new Date(),
        });

      // Existing idempotency key with a DIFFERENT payload hash
      mockTransferRepo.findIdempotencyKey.mockResolvedValueOnce({
        id: 'idemp-1',
        user_id: 'user-1',
        key: 'idemp-key-repeat',
        request_path: '/api/v1/transfers',
        request_hash: 'different_sha256_hash_here',
        response_status: 200,
        response_body: { status: 'COMPLETED' },
        status: 'COMPLETED',
        created_at: new Date(),
        expires_at: new Date(Date.now() + 86400000),
      });

      await expect(
        transferService.executeTransfer('user-1', {
          recipientId: 'user-2',
          amount: 5000,
          currency: 'INR',
          idempotencyKey: 'idemp-key-repeat',
        })
      ).rejects.toThrow(ConflictError);
    });
  });
});
