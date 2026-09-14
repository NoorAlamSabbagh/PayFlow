import { PoolClient } from 'pg';
import { ledgerRepository, LedgerRepository } from './ledger.repository';
import {
  DoubleEntryTransactionInput,
  LedgerEntryEntity,
  TransactionEntity,
  LedgerHistoryResponseDto,
  LedgerEntryResponseDto,
} from './ledger.types';
import { BadRequestError, ConflictError } from '../../utils/errors';
import { logger } from '../../config/logger';

export class LedgerService {
  constructor(private ledgerRepo: LedgerRepository = ledgerRepository) {}

  /**
   * Post an atomic balanced double-entry transaction.
   * MUST be called within an active PostgreSQL client transaction.
   */
  async postDoubleEntryTransaction(
    input: DoubleEntryTransactionInput,
    client: PoolClient
  ): Promise<{ transaction: TransactionEntity; entries: LedgerEntryEntity[] }> {
    // 1. Invariant: Amount must be positive integer paise
    if (input.amount <= 0n) {
      throw new BadRequestError('Transaction amount must be strictly greater than zero', 'INVALID_AMOUNT');
    }

    // 2. Invariant: Must contain at least two entries
    if (!input.entries || input.entries.length < 2) {
      throw new BadRequestError(
        'Double-entry transaction must contain at least two counterparty entries',
        'INSUFFICIENT_LEDGER_ENTRIES'
      );
    }

    // 3. Invariant: Validate each entry amount > 0 and calculate totals
    let totalDebits = 0n;
    let totalCredits = 0n;

    for (const entry of input.entries) {
      if (entry.amount <= 0n) {
        throw new BadRequestError('Ledger entry amount must be strictly positive', 'INVALID_ENTRY_AMOUNT');
      }
      if (entry.entryType === 'DEBIT') {
        totalDebits += entry.amount;
      } else if (entry.entryType === 'CREDIT') {
        totalCredits += entry.amount;
      } else {
        throw new BadRequestError(`Invalid ledger entry type: ${entry.entryType}`, 'INVALID_ENTRY_TYPE');
      }
    }

    // 4. CORE ACCOUNTING INVARIANT: Debits MUST equal Credits
    if (totalDebits !== totalCredits) {
      logger.error('CRITICAL ACCOUNTING INVARIANT VIOLATION: Unbalanced ledger entries rejected', {
        totalDebits: totalDebits.toString(),
        totalCredits: totalCredits.toString(),
        referenceId: input.referenceId,
      });
      throw new BadRequestError(
        `Ledger entries are unbalanced. Total Debits (${totalDebits.toString()}) != Total Credits (${totalCredits.toString()})`,
        'UNBALANCED_LEDGER_TRANSACTION'
      );
    }

    // 5. Invariant: Total Debits must match transaction aggregate amount
    if (totalDebits !== input.amount) {
      throw new BadRequestError(
        `Ledger entries sum (${totalDebits.toString()}) does not match transaction amount (${input.amount.toString()})`,
        'AMOUNT_MISMATCH'
      );
    }

    // 6. Check for duplicate reference ID
    const existingTxn = await this.ledgerRepo.findTransactionByReference(input.referenceId, client);
    if (existingTxn) {
      throw new ConflictError(
        `A financial transaction with reference '${input.referenceId}' already exists`,
        'DUPLICATE_TRANSACTION_REFERENCE'
      );
    }

    // 7. Write transaction container record
    const transaction = await this.ledgerRepo.createTransaction(
      {
        referenceId: input.referenceId,
        type: input.type,
        status: 'COMPLETED',
        amount: input.amount,
        currency: input.currency,
        senderWalletId: input.senderWalletId,
        receiverWalletId: input.receiverWalletId,
        metadata: input.metadata,
      },
      client
    );

    // 8. Write immutable ledger entries
    const entries = await this.ledgerRepo.createLedgerEntries(input.entries, transaction.id, client);

    logger.info('Double-entry transaction posted successfully', {
      transactionId: transaction.id,
      referenceId: input.referenceId,
      amount: input.amount.toString(),
      currency: input.currency,
      entriesCount: entries.length,
    });

    return { transaction, entries };
  }

  /**
   * Fetch paginated ledger history for a wallet
   */
  async getWalletLedgerHistory(
    walletId: string,
    page = 1,
    limit = 20
  ): Promise<LedgerHistoryResponseDto> {
    const safePage = Math.max(1, page);
    const safeLimit = Math.min(100, Math.max(1, limit));
    const offset = (safePage - 1) * safeLimit;

    const { entries, total } = await this.ledgerRepo.getLedgerEntriesByWalletId(
      walletId,
      safeLimit,
      offset
    );

    const formattedEntries: LedgerEntryResponseDto[] = entries.map((row) => {
      const amountPaise = parseInt(row.amount, 10);
      const balanceAfterPaise = parseInt(row.balance_after, 10);

      return {
        id: row.id,
        transactionId: row.transaction_id,
        referenceId: row.reference_id,
        entryType: row.entry_type,
        amount: amountPaise,
        balanceAfter: balanceAfterPaise,
        formattedAmount: `₹${(amountPaise / 100).toLocaleString('en-IN', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}`,
        formattedBalanceAfter: `₹${(balanceAfterPaise / 100).toLocaleString('en-IN', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}`,
        description: row.description,
        createdAt: new Date(row.created_at).toISOString(),
      };
    });

    return {
      entries: formattedEntries,
      pagination: {
        page: safePage,
        limit: safeLimit,
        total,
        totalPages: Math.ceil(total / safeLimit) || 1,
      },
    };
  }
}

export const ledgerService = new LedgerService();
