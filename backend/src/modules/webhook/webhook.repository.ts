import { Pool, PoolClient } from 'pg';
import { pool } from '../../database';

export interface WebhookEventEntity {
  id: string;
  gatewayName: string;
  gatewayEventId: string;
  eventType: string;
  payload: Record<string, unknown>;
  payloadHash: string | null;
  isProcessed: boolean;
  processedAt: Date | null;
  errorMessage: string | null;
  createdAt: Date;
}

export class WebhookRepository {
  private pool: Pool;

  constructor(customPool?: Pool) {
    this.pool = customPool || pool;
  }

  private mapRow(row: any): WebhookEventEntity {
    return {
      id: row.id,
      gatewayName: row.gateway_name,
      gatewayEventId: row.gateway_event_id,
      eventType: row.event_type,
      payload: row.payload || {},
      payloadHash: row.payload_hash || null,
      isProcessed: row.is_processed,
      processedAt: row.processed_at ? new Date(row.processed_at) : null,
      errorMessage: row.error_message,
      createdAt: new Date(row.created_at),
    };
  }

  async findEvent(
    gatewayName: string,
    gatewayEventId: string,
    client?: PoolClient
  ): Promise<WebhookEventEntity | null> {
    const db = client || this.pool;
    const sql = `
      SELECT * FROM webhook_events
      WHERE gateway_name = $1 AND gateway_event_id = $2;
    `;
    const res = await db.query(sql, [gatewayName, gatewayEventId]);
    if (res.rowCount === 0) return null;
    return this.mapRow(res.rows[0]);
  }

  async recordEvent(
    params: {
      gatewayName: string;
      gatewayEventId: string;
      eventType: string;
      payload: Record<string, unknown>;
      payloadHash?: string;
    },
    client?: PoolClient
  ): Promise<WebhookEventEntity> {
    const db = client || this.pool;
    const sql = `
      INSERT INTO webhook_events (
        gateway_name,
        gateway_event_id,
        event_type,
        payload,
        payload_hash,
        is_processed
      )
      VALUES ($1, $2, $3, $4, $5, false)
      ON CONFLICT (gateway_name, gateway_event_id) DO UPDATE
      SET payload = $4, payload_hash = COALESCE($5, webhook_events.payload_hash)
      RETURNING *;
    `;
    const res = await db.query(sql, [
      params.gatewayName,
      params.gatewayEventId,
      params.eventType,
      JSON.stringify(params.payload),
      params.payloadHash || null,
    ]);
    return this.mapRow(res.rows[0]);
  }

  async markProcessed(
    gatewayName: string,
    gatewayEventId: string,
    isProcessed: boolean,
    errorMessage?: string,
    client?: PoolClient
  ): Promise<void> {
    const db = client || this.pool;
    const sql = `
      UPDATE webhook_events
      SET
        is_processed = $3,
        processed_at = NOW(),
        error_message = $4
      WHERE gateway_name = $1 AND gateway_event_id = $2;
    `;
    await db.query(sql, [
      gatewayName,
      gatewayEventId,
      isProcessed,
      errorMessage || null,
    ]);
  }
}
