import { PoolClient } from 'pg';
import { LedgerService } from '../../src/modules/ledger/ledger.service';
import { LedgerRepository } from '../../src/modules/ledger/ledger.repository';
import { BadRequestError, ConflictError } from '../../src/utils/errors';
import { TransactionEntity, LedgerEntryEntity } from '../../src/modules/ledger/ledger.types';

describe('LedgerService Unit Tests', () => {
  let ledgerService: LedgerService;
  let mockLedgerRepo: jest.Mocked<LedgerRepository>;
  let mockClient: jest.Mocked<PoolClient>;

  const mockTxn: TransactionEntity = {
    id: 'txn-uuid-1',
    reference_id: 'TXN_TEST_1001',
    type: 'TOPUP',
    status: 'COMPLETED',
    amount: '100000',
    currency: 'INR',
    sender_wallet_id: 'clearing-uuid',
    receiver_wallet_id: 'user-uuid',
    failure_reason: null,
    metadata: {},
    created_at: new Date(),
    updated_at: new Date(),
  };

  const mockEntries: LedgerEntryEntity[] = [
    {
      id: 'entry-uuid-1',
      transaction_id: 'txn-uuid-1',
      wallet_id: 'clearing-uuid',
      entry_type: 'DEBIT',
      amount: '100000',
      balance_after: '100000',
      description: 'Clearing Inflow',
      created_at: new Date(),
    },
    {
      id: 'entry-uuid-2',
      transaction_id: 'txn-uuid-1',
      wallet_id: 'user-uuid',
      entry_type: 'CREDIT',
      amount: '100000',
      balance_after: '100000',
      description: 'User Deposit',
      created_at: new Date(),
    },
  ];

  beforeEach(() => {
    mockLedgerRepo = {
      createTransaction: jest.fn().mockResolvedValue(mockTxn),
      createLedgerEntries: jest.fn().mockResolvedValue(mockEntries),
      findTransactionByReference: jest.fn().mockResolvedValue(null),
      getLedgerEntriesByWalletId: jest.fn().mockResolvedValue({ entries: [], total: 0 }),
    } as unknown as jest.Mocked<LedgerRepository>;

    mockClient = {
      query: jest.fn(),
    } as unknown as jest.Mocked<PoolClient>;

    ledgerService = new LedgerService(mockLedgerRepo);
  });

  describe('postDoubleEntryTransaction', () => {
    it('should successfully post a balanced double-entry transaction', async () => {
      const result = await ledgerService.postDoubleEntryTransaction(
        {
          referenceId: 'TXN_TEST_1001',
          type: 'TOPUP',
          amount: 100000n,
          currency: 'INR',
          senderWalletId: 'clearing-uuid',
          receiverWalletId: 'user-uuid',
          entries: [
            {
              walletId: 'clearing-uuid',
              entryType: 'DEBIT',
              amount: 100000n,
              balanceAfter: 100000n,
              description: 'Clearing Inflow',
            },
            {
              walletId: 'user-uuid',
              entryType: 'CREDIT',
              amount: 100000n,
              balanceAfter: 100000n,
              description: 'User Deposit',
            },
          ],
        },
        mockClient
      );

      expect(result.transaction.id).toBe('txn-uuid-1');
      expect(result.entries).toHaveLength(2);
      expect(mockLedgerRepo.createTransaction).toHaveBeenCalledTimes(1);
      expect(mockLedgerRepo.createLedgerEntries).toHaveBeenCalledTimes(1);
    });

    it('should reject an unbalanced transaction where Debits != Credits', async () => {
      await expect(
        ledgerService.postDoubleEntryTransaction(
          {
            referenceId: 'TXN_TEST_UNBALANCED',
            type: 'TOPUP',
            amount: 100000n,
            currency: 'INR',
            senderWalletId: 'clearing-uuid',
            receiverWalletId: 'user-uuid',
            entries: [
              {
                walletId: 'clearing-uuid',
                entryType: 'DEBIT',
                amount: 100000n,
                balanceAfter: 100000n,
                description: 'Clearing Inflow',
              },
              {
                walletId: 'user-uuid',
                entryType: 'CREDIT',
                amount: 80000n, // UNBALANCED! 100000 != 80000
                balanceAfter: 80000n,
                description: 'Partial Credit',
              },
            ],
          },
          mockClient
        )
      ).rejects.toThrow(BadRequestError);

      expect(mockLedgerRepo.createTransaction).not.toHaveBeenCalled();
      expect(mockLedgerRepo.createLedgerEntries).not.toHaveBeenCalled();
    });

    it('should reject non-positive transaction amounts (<= 0)', async () => {
      await expect(
        ledgerService.postDoubleEntryTransaction(
          {
            referenceId: 'TXN_ZERO',
            type: 'TOPUP',
            amount: 0n,
            currency: 'INR',
            senderWalletId: 'clearing-uuid',
            receiverWalletId: 'user-uuid',
            entries: [],
          },
          mockClient
        )
      ).rejects.toThrow(BadRequestError);
    });

    it('should reject transactions with fewer than 2 entries', async () => {
      await expect(
        ledgerService.postDoubleEntryTransaction(
          {
            referenceId: 'TXN_ONE_ENTRY',
            type: 'TOPUP',
            amount: 100000n,
            currency: 'INR',
            senderWalletId: null,
            receiverWalletId: 'user-uuid',
            entries: [
              {
                walletId: 'user-uuid',
                entryType: 'CREDIT',
                amount: 100000n,
                balanceAfter: 100000n,
                description: 'Unilateral entry',
              },
            ],
          },
          mockClient
        )
      ).rejects.toThrow(BadRequestError);
    });

    it('should throw ConflictError if transaction reference already exists', async () => {
      mockLedgerRepo.findTransactionByReference.mockResolvedValue(mockTxn);

      await expect(
        ledgerService.postDoubleEntryTransaction(
          {
            referenceId: 'TXN_TEST_1001',
            type: 'TOPUP',
            amount: 100000n,
            currency: 'INR',
            senderWalletId: 'clearing-uuid',
            receiverWalletId: 'user-uuid',
            entries: [
              {
                walletId: 'clearing-uuid',
                entryType: 'DEBIT',
                amount: 100000n,
                balanceAfter: 100000n,
                description: 'Clearing Inflow',
              },
              {
                walletId: 'user-uuid',
                entryType: 'CREDIT',
                amount: 100000n,
                balanceAfter: 100000n,
                description: 'User Deposit',
              },
            ],
          },
          mockClient
        )
      ).rejects.toThrow(ConflictError);
    });
  });
});
