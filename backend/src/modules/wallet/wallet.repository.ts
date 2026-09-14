import { PoolClient } from 'pg';
import { query } from '../../database';
import { WalletEntity, WalletType, WalletStatus } from './wallet.types';

export class WalletRepository {
  /**
   * Find wallet by user ID and currency
   */
  async findByUserId(
    userId: string,
    currency = 'INR',
    client?: PoolClient
  ): Promise<WalletEntity | null> {
    const sql = `
      SELECT id, user_id, type, currency, balance::text, version::text, status, created_at, updated_at
      FROM wallets
      WHERE user_id = $1 AND currency = $2
      LIMIT 1;
    `;
    const res = client
      ? await client.query<WalletEntity>(sql, [userId, currency])
      : await query<WalletEntity>(sql, [userId, currency]);

    return res.rows[0] || null;
  }

  /**
   * Find wallet by UUID
   */
  async findById(id: string, client?: PoolClient): Promise<WalletEntity | null> {
    const sql = `
      SELECT id, user_id, type, currency, balance::text, version::text, status, created_at, updated_at
      FROM wallets
      WHERE id = $1
      LIMIT 1;
    `;
    const res = client
      ? await client.query<WalletEntity>(sql, [id])
      : await query<WalletEntity>(sql, [id]);

    return res.rows[0] || null;
  }

  /**
   * Create a new wallet record
   */
  async createWallet(
    params: {
      userId: string | null;
      type?: WalletType;
      currency?: string;
      initialBalance?: bigint;
      status?: WalletStatus;
    },
    client?: PoolClient
  ): Promise<WalletEntity> {
    const {
      userId,
      type = 'USER',
      currency = 'INR',
      initialBalance = 0n,
      status = 'ACTIVE',
    } = params;

    const sql = `
      INSERT INTO wallets (user_id, type, currency, balance, version, status)
      VALUES ($1, $2, $3, $4, 0, $5)
      RETURNING id, user_id, type, currency, balance::text, version::text, status, created_at, updated_at;
    `;
    const sqlParams = [userId, type, currency, initialBalance.toString(), status];

    const res = client
      ? await client.query<WalletEntity>(sql, sqlParams)
      : await query<WalletEntity>(sql, sqlParams);

    return res.rows[0];
  }

  /**
   * Acquire deterministic row-level locks on multiple wallets to prevent deadlocks and lost updates.
   * Crucial rule: ORDER BY id ASC guarantees lock acquisition order across concurrent requests.
   */
  async findAndLockWallets(
    walletIds: string[],
    client: PoolClient
  ): Promise<Map<string, WalletEntity>> {
    const sql = `
      SELECT id, user_id, type, currency, balance::text, version::text, status, created_at, updated_at
      FROM wallets
      WHERE id = ANY($1::uuid[])
      ORDER BY id ASC
      FOR UPDATE;
    `;
    const res = await client.query<WalletEntity>(sql, [walletIds]);
    const walletMap = new Map<string, WalletEntity>();
    for (const row of res.rows) {
      walletMap.set(row.id, row);
    }
    return walletMap;
  }

  /**
   * Synchronize wallet cached balance within an active locked transaction
   */
  async updateBalance(
    walletId: string,
    newBalance: bigint,
    client: PoolClient
  ): Promise<WalletEntity> {
    const sql = `
      UPDATE wallets
      SET balance = $1, version = version + 1, updated_at = NOW()
      WHERE id = $2
      RETURNING id, user_id, type, currency, balance::text, version::text, status, created_at, updated_at;
    `;
    const res = await client.query<WalletEntity>(sql, [newBalance.toString(), walletId]);
    return res.rows[0];
  }
}

export const walletRepository = new WalletRepository();
