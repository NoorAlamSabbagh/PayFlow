import { PoolClient } from 'pg';
import { query } from '../../database';
import { UserEntity, UserRole } from './user.types';

export class UserRepository {
  /**
   * Find user by email (case-insensitive)
   */
  async findByEmail(email: string, client?: PoolClient): Promise<UserEntity | null> {
    const sql = `
      SELECT id, email, password_hash, full_name, role, is_active, created_at, updated_at
      FROM users
      WHERE LOWER(email) = LOWER($1)
      LIMIT 1;
    `;
    const res = client ? await client.query<UserEntity>(sql, [email]) : await query<UserEntity>(sql, [email]);
    return res.rows[0] || null;
  }

  /**
   * Find user by UUID
   */
  async findById(id: string, client?: PoolClient): Promise<UserEntity | null> {
    const sql = `
      SELECT id, email, password_hash, full_name, role, is_active, created_at, updated_at
      FROM users
      WHERE id = $1
      LIMIT 1;
    `;
    const res = client ? await client.query<UserEntity>(sql, [id]) : await query<UserEntity>(sql, [id]);
    return res.rows[0] || null;
  }

  /**
   * Insert a new user record
   */
  async createUser(
    userData: {
      email: string;
      passwordHash: string;
      fullName: string;
      role?: UserRole;
    },
    client?: PoolClient
  ): Promise<UserEntity> {
    const { email, passwordHash, fullName, role = 'USER' } = userData;
    const sql = `
      INSERT INTO users (email, password_hash, full_name, role, is_active)
      VALUES (LOWER($1), $2, $3, $4, true)
      RETURNING id, email, password_hash, full_name, role, is_active, created_at, updated_at;
    `;
    const params = [email, passwordHash, fullName, role];
    const res = client ? await client.query<UserEntity>(sql, params) : await query<UserEntity>(sql, params);
    return res.rows[0];
  }
}

export const userRepository = new UserRepository();
