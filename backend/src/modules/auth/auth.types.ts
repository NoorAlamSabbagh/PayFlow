import { z } from 'zod';
import { UserResponseDto } from '../user/user.types';

export const registerSchema = z.object({
  email: z.string().email('Invalid email address').max(255),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters long')
    .max(72, 'Password must not exceed 72 characters')
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
    .regex(/[0-9]/, 'Password must contain at least one number'),
  fullName: z.string().min(2, 'Full name must be at least 2 characters long').max(150),
  role: z.enum(['USER', 'ADMIN', 'OPERATOR'] as const).optional().default('USER'),
});

export const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface AuthResultDto {
  user: UserResponseDto;
  accessToken: string;
}

export interface RefreshTokenEntity {
  id: string;
  user_id: string;
  token_hash: string;
  family_id: string;
  is_revoked: boolean;
  expires_at: Date;
  created_at: Date;
}
