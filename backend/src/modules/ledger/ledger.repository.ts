import { PoolClient } from 'pg';
import { query } from '../../database';
import {
  LedgerEntryEntity,
  TransactionEntity,
  CreateTransactionRecordInput,
  PostLedgerEntryInput,
} from './ledger.types';

export interface LedgerHistoryRow extends LedgerEntryEntity {
  reference_id: string;
}

export class LedgerRepository {
  /**
   * Insert high-level transaction record inside an active database transaction
   */
  async createTransaction(
    input: CreateTransactionRecordInput,
    client: PoolClient
  ): Promise<TransactionEntity> {
    const sql = `
      INSERT INTO transactions (
        reference_id,
        type,
        status,
        amount,
        currency,
        sender_wallet_id,
        receiver_wallet_id,
        metadata
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING
        id,
        reference_id,
        type,
        status,
        amount::text,
        currency,
        sender_wallet_id,
        receiver_wallet_id,
        failure_reason,
        metadata,
        created_at,
        updated_at;
    `;
    const params = [
      input.referenceId,
      input.type,
      input.status,
      input.amount.toString(),
      input.currency,
      input.senderWalletId,
      input.receiverWalletId,
      JSON.stringify(input.metadata || {}),
    ];

    const res = await client.query<TransactionEntity>(sql, params);
    return res.rows[0];
  }

  /**
   * Insert immutable ledger entries inside an active database transaction
   */
  async createLedgerEntries(
    entries: PostLedgerEntryInput[],
    transactionId: string,
    client: PoolClient
  ): Promise<LedgerEntryEntity[]> {
    const inserted: LedgerEntryEntity[] = [];

    const sql = `
      INSERT INTO ledger_entries (
        transaction_id,
        wallet_id,
        entry_type,
        amount,
        balance_after,
        description
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING
        id,
        transaction_id,
        wallet_id,
        entry_type,
        amount::text,
        balance_after::text,
        description,
        created_at;
    `;

    for (const entry of entries) {
      const params = [
        transactionId,
        entry.walletId,
        entry.entryType,
        entry.amount.toString(),
        entry.balanceAfter.toString(),
        entry.description,
      ];
      const res = await client.query<LedgerEntryEntity>(sql, params);
      inserted.push(res.rows[0]);
    }

    return inserted;
  }

  /**
   * Find transaction by idempotent reference ID
   */
  async findTransactionByReference(
    referenceId: string,
    client?: PoolClient
  ): Promise<TransactionEntity | null> {
    const sql = `
      SELECT
        id,
        reference_id,
        type,
        status,
        amount::text,
        currency,
        sender_wallet_id,
        receiver_wallet_id,
        failure_reason,
        metadata,
        created_at,
        updated_at
      FROM transactions
      WHERE reference_id = $1
      LIMIT 1;
    `;
    const res = client
      ? await client.query<TransactionEntity>(sql, [referenceId])
      : await query<TransactionEntity>(sql, [referenceId]);

    return res.rows[0] || null;
  }

  /**
   * Retrieve paginated ledger history for a specific wallet
   */
  async getLedgerEntriesByWalletId(
    walletId: string,
    limit: number,
    offset: number
  ): Promise<{ entries: LedgerHistoryRow[]; total: number }> {
    const countSql = `
      SELECT COUNT(*)::text AS total
      FROM ledger_entries
      WHERE wallet_id = $1;
    `;
    const countRes = await query<{ total: string }>(countSql, [walletId]);
    const total = parseInt(countRes.rows[0]?.total || '0', 10);

    const listSql = `
      SELECT
        le.id,
        le.transaction_id,
        le.wallet_id,
        le.entry_type,
        le.amount::text,
        le.balance_after::text,
        le.description,
        le.created_at,
        t.reference_id
      FROM ledger_entries le
      JOIN transactions t ON le.transaction_id = t.id
      WHERE le.wallet_id = $1
      ORDER BY le.created_at DESC
      LIMIT $2 OFFSET $3;
    `;
    const listRes = await query<LedgerHistoryRow>(listSql, [walletId, limit, offset]);

    return {
      entries: listRes.rows,
      total,
    };
  }
}

export const ledgerRepository = new LedgerRepository();
