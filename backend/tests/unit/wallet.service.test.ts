import { WalletService } from '../../src/modules/wallet/wallet.service';
import { WalletRepository } from '../../src/modules/wallet/wallet.repository';
import { LedgerService } from '../../src/modules/ledger/ledger.service';
import { WalletEntity, SYSTEM_WALLETS } from '../../src/modules/wallet/wallet.types';
import { BadRequestError } from '../../src/utils/errors';

const mockClient = {
  query: jest.fn().mockResolvedValue({ rows: [] }),
  release: jest.fn(),
};

jest.mock('../../src/database', () => ({
  getClient: jest.fn().mockImplementation(() => Promise.resolve(mockClient)),
  query: jest.fn(),
}));

describe('WalletService Unit Tests', () => {
  let walletService: WalletService;
  let mockWalletRepo: jest.Mocked<WalletRepository>;
  let mockLedgerServ: jest.Mocked<LedgerService>;

  const mockUserWallet: WalletEntity = {
    id: 'user-wallet-uuid',
    user_id: 'user-uuid-1',
    type: 'USER',
    currency: 'INR',
    balance: '50000', // ₹500
    version: '1',
    status: 'ACTIVE',
    created_at: new Date(),
    updated_at: new Date(),
  };

  const mockClearingWallet: WalletEntity = {
    id: SYSTEM_WALLETS.GATEWAY_CLEARING,
    user_id: null,
    type: 'SYSTEM_GATEWAY_CLEARING',
    currency: 'INR',
    balance: '0',
    version: '0',
    status: 'ACTIVE',
    created_at: new Date(),
    updated_at: new Date(),
  };

  beforeEach(() => {
    jest.clearAllMocks();

    mockWalletRepo = {
      findByUserId: jest.fn().mockResolvedValue(mockUserWallet),
      findById: jest.fn(),
      createWallet: jest.fn(),
      findAndLockWallets: jest.fn().mockResolvedValue(
        new Map([
          [mockUserWallet.id, mockUserWallet],
          [SYSTEM_WALLETS.GATEWAY_CLEARING, mockClearingWallet],
        ])
      ),
      updateBalance: jest.fn().mockImplementation((walletId, newBal) => {
        return Promise.resolve({
          ...mockUserWallet,
          id: walletId,
          balance: newBal.toString(),
        });
      }),
    } as unknown as jest.Mocked<WalletRepository>;

    mockLedgerServ = {
      postDoubleEntryTransaction: jest.fn().mockResolvedValue({
        transaction: {},
        entries: [],
      }),
      getWalletLedgerHistory: jest.fn().mockResolvedValue({ entries: [], pagination: {} }),
    } as unknown as jest.Mocked<LedgerService>;

    walletService = new WalletService(mockWalletRepo, mockLedgerServ);
  });

  describe('getOrCreateUserWallet', () => {
    it('should return existing wallet if already provisioned', async () => {
      mockWalletRepo.findByUserId.mockResolvedValue(mockUserWallet);

      const wallet = await walletService.getOrCreateUserWallet('user-uuid-1');

      expect(wallet.id).toBe(mockUserWallet.id);
      expect(mockWalletRepo.createWallet).not.toHaveBeenCalled();
    });

    it('should provision a new ACTIVE wallet if none exists', async () => {
      mockWalletRepo.findByUserId.mockResolvedValue(null);
      mockWalletRepo.createWallet.mockResolvedValue({
        ...mockUserWallet,
        balance: '0',
      });

      const wallet = await walletService.getOrCreateUserWallet('new-user-uuid');

      expect(wallet.status).toBe('ACTIVE');
      expect(mockWalletRepo.createWallet).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'new-user-uuid',
          type: 'USER',
          currency: 'INR',
          initialBalance: 0n,
          status: 'ACTIVE',
        }),
        undefined
      );
    });
  });

  describe('deposit (Add Demo Money)', () => {
    it('should atomically process valid deposit with row-locking and double-entry ledger', async () => {
      const result = await walletService.deposit('user-uuid-1', {
        amount: 100000, // ₹1,000 in paise
        description: 'Test Top-up',
      });

      expect(result.status).toBe('COMPLETED');
      expect(result.amount).toBe(100000);
      expect(result.previousBalance).toBe(50000);
      expect(result.newBalance).toBe(150000);
      expect(result.formattedNewBalance).toBe('₹1,500.00');

      // Verify BEGIN and COMMIT were invoked
      expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
      expect(mockClient.query).toHaveBeenCalledWith('COMMIT');

      // Verify row locks acquired on both counterparties
      expect(mockWalletRepo.findAndLockWallets).toHaveBeenCalledWith(
        [SYSTEM_WALLETS.GATEWAY_CLEARING, mockUserWallet.id],
        mockClient
      );

      // Verify double-entry ledger was posted
      expect(mockLedgerServ.postDoubleEntryTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'TOPUP',
          amount: 100000n,
          currency: 'INR',
          senderWalletId: SYSTEM_WALLETS.GATEWAY_CLEARING,
          receiverWalletId: mockUserWallet.id,
        }),
        mockClient
      );

      // Verify client released back to pool
      expect(mockClient.release).toHaveBeenCalled();
    });

    it('should reject non-positive deposit amount', async () => {
      await expect(
        walletService.deposit('user-uuid-1', {
          amount: 0,
        })
      ).rejects.toThrow(BadRequestError);

      expect(mockClient.query).not.toHaveBeenCalledWith('BEGIN');
    });

    it('should execute ROLLBACK if ledger posting fails', async () => {
      mockLedgerServ.postDoubleEntryTransaction.mockRejectedValue(new Error('Ledger write error'));

      await expect(
        walletService.deposit('user-uuid-1', {
          amount: 100000,
        })
      ).rejects.toThrow('Ledger write error');

      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
      expect(mockClient.release).toHaveBeenCalled();
    });
  });
});
