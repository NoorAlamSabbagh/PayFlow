import { Request, Response, NextFunction } from 'express';
import { userRepository, UserRepository } from './user.repository';
import { sendSuccess } from '../../utils/response';
import { NotFoundError } from '../../utils/errors';
import { toUserResponseDto } from './user.types';
import { query } from '../../database';
import { UserEntity } from './user.types';

export class UserController {
  constructor(private userRepo: UserRepository = userRepository) {}

  getMe = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.userId;
      const user = await this.userRepo.findById(userId);

      if (!user) {
        throw new NotFoundError('User profile not found', 'USER_NOT_FOUND');
      }

      sendSuccess(res, toUserResponseDto(user), 'User profile fetched successfully', 200);
    } catch (error) {
      next(error);
    }
  };

  /**
   * List/search active counterparties (excluding current user) for recipient selection
   */
  getCounterparties = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const currentUserId = req.user!.userId;
      const search = (req.query.search as string) || '';

      const sql = `
        SELECT id, email, full_name, created_at
        FROM users
        WHERE id != $1 AND is_active = true
          AND (
            $2 = '' 
            OR full_name ILIKE ('%' || $2 || '%') 
            OR email ILIKE ('%' || $2 || '%')
          )
        ORDER BY full_name ASC
        LIMIT 20;
      `;
      const result = await query<{ id: string; email: string; full_name: string }>(sql, [currentUserId, search]);
      const counterparties = result.rows.map((row) => ({
        id: row.id,
        email: row.email,
        fullName: row.full_name,
      }));

      sendSuccess(res, counterparties, 'Counterparties fetched successfully', 200);
    } catch (error) {
      next(error);
    }
  };

  /**
   * Admin-only endpoint to demonstrate RBAC gating
   */
  getAllUsers = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const sql = 'SELECT id, email, full_name, role, is_active, created_at, updated_at FROM users ORDER BY created_at DESC;';
      const result = await query<UserEntity>(sql);
      const dtos = result.rows.map(toUserResponseDto);

      sendSuccess(res, dtos, 'All users fetched successfully (Admin access)', 200);
    } catch (error) {
      next(error);
    }
  };
}

export const userController = new UserController();
