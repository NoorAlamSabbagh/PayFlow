import { PoolClient } from 'pg';
import { query } from '../../database';
import { IdempotencyRecordEntity } from './transfer.types';
import { TransactionEntity } from '../ledger/ledger.types';

export interface EnrichedTransactionRow extends TransactionEntity {
  sender_user_id: string | null;
  sender_name: string | null;
  sender_email: string | null;
  receiver_user_id: string | null;
  receiver_name: string | null;
  receiver_email: string | null;
}

export class TransferRepository {
  /**
   * Look up an idempotency record for a specific user and key
   */
  async findIdempotencyKey(
    userId: string,
    key: string,
    client?: PoolClient
  ): Promise<IdempotencyRecordEntity | null> {
    const sql = `
      SELECT
        id,
        user_id,
        key,
        request_path,
        request_hash,
        response_status,
        response_body,
        status,
        created_at,
        expires_at
      FROM idempotency_keys
      WHERE user_id = $1 AND key = $2
      LIMIT 1;
    `;
    const res = client
      ? await client.query<IdempotencyRecordEntity>(sql, [userId, key])
      : await query<IdempotencyRecordEntity>(sql, [userId, key]);

    return res.rows[0] || null;
  }

  /**
   * Persist a completed idempotency response inside an active transaction
   */
  async saveIdempotencyKey(
    params: {
      userId: string;
      key: string;
      requestPath: string;
      requestHash: string;
      responseStatus: number;
      responseBody: Record<string, unknown>;
      ttlHours?: number;
    },
    client: PoolClient
  ): Promise<void> {
    const { userId, key, requestPath, requestHash, responseStatus, responseBody, ttlHours = 24 } = params;
    const sql = `
      INSERT INTO idempotency_keys (
        user_id,
        key,
        request_path,
        request_hash,
        response_status,
        response_body,
        status,
        expires_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, 'COMPLETED', NOW() + ($7 || ' hours')::interval)
      ON CONFLICT (user_id, key) DO UPDATE
      SET
        response_status = EXCLUDED.response_status,
        response_body = EXCLUDED.response_body,
        status = 'COMPLETED',
        expires_at = EXCLUDED.expires_at;
    `;
    await client.query(sql, [
      userId,
      key,
      requestPath,
      requestHash,
      responseStatus,
      JSON.stringify(responseBody),
      ttlHours.toString(),
    ]);
  }

  /**
   * Emit an outbox event atomically within the transaction
   */
  async createOutboxEvent(
    params: {
      aggregateType: string;
      aggregateId: string;
      eventType: string;
      payload: Record<string, unknown>;
    },
    client: PoolClient
  ): Promise<void> {
    const { aggregateType, aggregateId, eventType, payload } = params;
    const sql = `
      INSERT INTO outbox_events (
        aggregate_type,
        aggregate_id,
        event_type,
        payload,
        status
      )
      VALUES ($1, $2, $3, $4, 'PENDING');
    `;
    await client.query(sql, [
      aggregateType,
      aggregateId,
      eventType,
      JSON.stringify(payload),
    ]);
  }

  /**
   * Lookup single transaction enriched with sender and receiver profiles
   */
  async findTransactionById(
    transactionId: string,
    client?: PoolClient
  ): Promise<EnrichedTransactionRow | null> {
    const sql = `
      SELECT
        t.id,
        t.reference_id,
        t.type,
        t.status,
        t.amount::text,
        t.currency,
        t.sender_wallet_id,
        t.receiver_wallet_id,
        t.failure_reason,
        t.metadata,
        t.created_at,
        t.updated_at,
        sw.user_id AS sender_user_id,
        su.full_name AS sender_name,
        su.email AS sender_email,
        rw.user_id AS receiver_user_id,
        ru.full_name AS receiver_name,
        ru.email AS receiver_email
      FROM transactions t
      LEFT JOIN wallets sw ON t.sender_wallet_id = sw.id
      LEFT JOIN users su ON sw.user_id = su.id
      LEFT JOIN wallets rw ON t.receiver_wallet_id = rw.id
      LEFT JOIN users ru ON rw.user_id = ru.id
      WHERE t.id = $1
      LIMIT 1;
    `;
    const res = client
      ? await client.query<EnrichedTransactionRow>(sql, [transactionId])
      : await query<EnrichedTransactionRow>(sql, [transactionId]);

    return res.rows[0] || null;
  }

  /**
   * Fetch paginated transactions involving the specified wallet ID
   */
  async findTransactionsByWalletId(
    walletId: string,
    options: {
      limit: number;
      offset: number;
      status?: string;
      direction?: 'INCOMING' | 'OUTGOING';
    }
  ): Promise<{ transactions: EnrichedTransactionRow[]; total: number }> {
    const { limit, offset, status, direction } = options;

    const conditions: string[] = [];
    const params: unknown[] = [walletId];

    if (direction === 'INCOMING') {
      conditions.push(`t.receiver_wallet_id = $1`);
    } else if (direction === 'OUTGOING') {
      conditions.push(`t.sender_wallet_id = $1`);
    } else {
      conditions.push(`(t.sender_wallet_id = $1 OR t.receiver_wallet_id = $1)`);
    }

    if (status) {
      params.push(status);
      conditions.push(`t.status = $${params.length}`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countSql = `
      SELECT COUNT(*)::text AS total
      FROM transactions t
      ${whereClause};
    `;
    const countRes = await query<{ total: string }>(countSql, params);
    const total = parseInt(countRes.rows[0]?.total || '0', 10);

    params.push(limit);
    const limitParamIndex = params.length;
    params.push(offset);
    const offsetParamIndex = params.length;

    const listSql = `
      SELECT
        t.id,
        t.reference_id,
        t.type,
        t.status,
        t.amount::text,
        t.currency,
        t.sender_wallet_id,
        t.receiver_wallet_id,
        t.failure_reason,
        t.metadata,
        t.created_at,
        t.updated_at,
        sw.user_id AS sender_user_id,
        su.full_name AS sender_name,
        su.email AS sender_email,
        rw.user_id AS receiver_user_id,
        ru.full_name AS receiver_name,
        ru.email AS receiver_email
      FROM transactions t
      LEFT JOIN wallets sw ON t.sender_wallet_id = sw.id
      LEFT JOIN users su ON sw.user_id = su.id
      LEFT JOIN wallets rw ON t.receiver_wallet_id = rw.id
      LEFT JOIN users ru ON rw.user_id = ru.id
      ${whereClause}
      ORDER BY t.created_at DESC
      LIMIT $${limitParamIndex} OFFSET $${offsetParamIndex};
    `;

    const listRes = await query<EnrichedTransactionRow>(listSql, params);

    return {
      transactions: listRes.rows,
      total,
    };
  }
}

export const transferRepository = new TransferRepository();
