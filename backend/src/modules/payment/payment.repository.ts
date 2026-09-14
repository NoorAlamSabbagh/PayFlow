import { Pool, PoolClient } from 'pg';
import { pool } from '../../database';
import { PaymentIntentEntity, PaymentIntentStatus } from './payment.types';

export class PaymentRepository {
  private pool: Pool;

  constructor(customPool?: Pool) {
    this.pool = customPool || pool;
  }

  private mapRowToEntity(row: any): PaymentIntentEntity {
    return {
      id: row.id,
      userId: row.user_id,
      walletId: row.wallet_id,
      amount: BigInt(row.amount),
      currency: row.currency,
      provider: row.provider || 'MOCK_GATEWAY',
      gatewayOrderId: row.gateway_order_id,
      gatewayPaymentId: row.gateway_payment_id,
      status: row.status,
      idempotencyKey: row.idempotency_key,
      errorMessage: row.error_message,
      metadata: row.metadata || {},
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
      completedAt: row.completed_at ? new Date(row.completed_at) : null,
    };
  }

  async createPaymentIntent(
    data: {
      userId: string;
      walletId: string;
      amount: bigint | number;
      currency: string;
      provider: string;
      gatewayOrderId: string;
      status: PaymentIntentStatus;
      idempotencyKey?: string;
      metadata?: Record<string, unknown>;
    },
    client?: PoolClient
  ): Promise<PaymentIntentEntity> {
    const db = client || this.pool;
    const sql = `
      INSERT INTO payment_intents (
        user_id,
        wallet_id,
        amount,
        currency,
        provider,
        gateway_order_id,
        status,
        idempotency_key,
        metadata
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *;
    `;
    const params = [
      data.userId,
      data.walletId,
      data.amount.toString(),
      data.currency,
      data.provider,
      data.gatewayOrderId,
      data.status,
      data.idempotencyKey || null,
      JSON.stringify(data.metadata || {}),
    ];
    const res = await db.query(sql, params);
    return this.mapRowToEntity(res.rows[0]);
  }

  async findPaymentIntentById(
    id: string,
    client?: PoolClient
  ): Promise<PaymentIntentEntity | null> {
    const db = client || this.pool;
    const sql = `SELECT * FROM payment_intents WHERE id = $1;`;
    const res = await db.query(sql, [id]);
    if (res.rowCount === 0) return null;
    return this.mapRowToEntity(res.rows[0]);
  }

  async findPaymentIntentByOrderId(
    orderId: string,
    client?: PoolClient
  ): Promise<PaymentIntentEntity | null> {
    const db = client || this.pool;
    const sql = `SELECT * FROM payment_intents WHERE gateway_order_id = $1;`;
    const res = await db.query(sql, [orderId]);
    if (res.rowCount === 0) return null;
    return this.mapRowToEntity(res.rows[0]);
  }

  async findPaymentIntentByIdForUpdate(
    orderId: string,
    client: PoolClient
  ): Promise<PaymentIntentEntity | null> {
    const sql = `SELECT * FROM payment_intents WHERE gateway_order_id = $1 FOR UPDATE;`;
    const res = await client.query(sql, [orderId]);
    if (res.rowCount === 0) return null;
    return this.mapRowToEntity(res.rows[0]);
  }

  async findPaymentIntentByIdempotency(
    userId: string,
    idempotencyKey: string,
    client?: PoolClient
  ): Promise<PaymentIntentEntity | null> {
    const db = client || this.pool;
    const sql = `
      SELECT * FROM payment_intents 
      WHERE user_id = $1 AND idempotency_key = $2;
    `;
    const res = await db.query(sql, [userId, idempotencyKey]);
    if (res.rowCount === 0) return null;
    return this.mapRowToEntity(res.rows[0]);
  }

  async updatePaymentIntentStatus(
    id: string,
    status: PaymentIntentStatus,
    details?: {
      gatewayPaymentId?: string;
      errorMessage?: string;
      completedAt?: Date;
    },
    client?: PoolClient
  ): Promise<PaymentIntentEntity> {
    const db = client || this.pool;
    const sql = `
      UPDATE payment_intents
      SET
        status = $2,
        gateway_payment_id = COALESCE($3, gateway_payment_id),
        error_message = COALESCE($4, error_message),
        completed_at = COALESCE($5, completed_at),
        updated_at = NOW()
      WHERE id = $1
      RETURNING *;
    `;
    const params = [
      id,
      status,
      details?.gatewayPaymentId || null,
      details?.errorMessage || null,
      details?.completedAt ? details.completedAt.toISOString() : null,
    ];
    const res = await db.query(sql, params);
    return this.mapRowToEntity(res.rows[0]);
  }

  async listPaymentIntentsByUser(
    userId: string,
    page: number = 1,
    limit: number = 20,
    status?: PaymentIntentStatus
  ): Promise<{ items: PaymentIntentEntity[]; total: number }> {
    const offset = (page - 1) * limit;
    const conditions: string[] = ['user_id = $1'];
    const params: any[] = [userId];

    if (status) {
      conditions.push(`status = $${params.length + 1}`);
      params.push(status);
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`;

    const countSql = `SELECT COUNT(*) AS total FROM payment_intents ${whereClause};`;
    const countRes = await this.pool.query(countSql, params);
    const total = parseInt(countRes.rows[0].total, 10);

    const listSql = `
      SELECT * FROM payment_intents
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2};
    `;
    const listRes = await this.pool.query(listSql, [...params, limit, offset]);

    return {
      items: listRes.rows.map((r) => this.mapRowToEntity(r)),
      total,
    };
  }

  async listAllPaymentIntents(
    page: number = 1,
    limit: number = 20,
    status?: PaymentIntentStatus
  ): Promise<{ items: PaymentIntentEntity[]; total: number }> {
    const offset = (page - 1) * limit;
    const conditions: string[] = [];
    const params: any[] = [];

    if (status) {
      conditions.push(`status = $${params.length + 1}`);
      params.push(status);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countSql = `SELECT COUNT(*) AS total FROM payment_intents ${whereClause};`;
    const countRes = await this.pool.query(countSql, params);
    const total = parseInt(countRes.rows[0].total, 10);

    const listSql = `
      SELECT * FROM payment_intents
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2};
    `;
    const listRes = await this.pool.query(listSql, [...params, limit, offset]);

    return {
      items: listRes.rows.map((r) => this.mapRowToEntity(r)),
      total,
    };
  }
}
