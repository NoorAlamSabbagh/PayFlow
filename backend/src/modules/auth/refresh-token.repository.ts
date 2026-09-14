import { PoolClient } from 'pg';
import { query } from '../../database';
import { RefreshTokenEntity } from './auth.types';

export class RefreshTokenRepository {
  /**
   * Save a newly issued refresh token hash with its family ID
   */
  async createRefreshToken(
    tokenData: {
      userId: string;
      tokenHash: string;
      familyId: string;
      expiresAt: Date;
    },
    client?: PoolClient
  ): Promise<RefreshTokenEntity> {
    const { userId, tokenHash, familyId, expiresAt } = tokenData;
    const sql = `
      INSERT INTO refresh_tokens (user_id, token_hash, family_id, expires_at)
      VALUES ($1, $2, $3, $4)
      RETURNING id, user_id, token_hash, family_id, is_revoked, expires_at, created_at;
    `;
    const params = [userId, tokenHash, familyId, expiresAt];
    const res = client ? await client.query<RefreshTokenEntity>(sql, params) : await query<RefreshTokenEntity>(sql, params);
    return res.rows[0];
  }

  /**
   * Lookup a refresh token by its SHA-256 hash
   */
  async findTokenByHash(tokenHash: string, client?: PoolClient): Promise<RefreshTokenEntity | null> {
    const sql = `
      SELECT id, user_id, token_hash, family_id, is_revoked, expires_at, created_at
      FROM refresh_tokens
      WHERE token_hash = $1
      LIMIT 1;
    `;
    const res = client ? await client.query<RefreshTokenEntity>(sql, [tokenHash]) : await query<RefreshTokenEntity>(sql, [tokenHash]);
    return res.rows[0] || null;
  }

  /**
   * Revoke a single rotated refresh token
   */
  async revokeToken(id: string, client?: PoolClient): Promise<void> {
    const sql = `
      UPDATE refresh_tokens
      SET is_revoked = true
      WHERE id = $1;
    `;
    if (client) {
      await client.query(sql, [id]);
    } else {
      await query(sql, [id]);
    }
  }

  /**
   * Revoke all tokens in an entire family (triggered on replay detection)
   */
  async revokeFamily(familyId: string, client?: PoolClient): Promise<number> {
    const sql = `
      UPDATE refresh_tokens
      SET is_revoked = true
      WHERE family_id = $1;
    `;
    const res = client ? await client.query(sql, [familyId]) : await query(sql, [familyId]);
    return res.rowCount || 0;
  }

  /**
   * Revoke all tokens for a user (e.g. global logout / password reset)
   */
  async revokeAllUserTokens(userId: string, client?: PoolClient): Promise<void> {
    const sql = `
      UPDATE refresh_tokens
      SET is_revoked = true
      WHERE user_id = $1;
    `;
    if (client) {
      await client.query(sql, [userId]);
    } else {
      await query(sql, [userId]);
    }
  }
}

export const refreshTokenRepository = new RefreshTokenRepository();
