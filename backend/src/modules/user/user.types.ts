export type UserRole = 'USER' | 'ADMIN' | 'OPERATOR';

export interface UserEntity {
  id: string;
  email: string;
  password_hash: string;
  full_name: string;
  role: UserRole;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface UserResponseDto {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  isActive: boolean;
  createdAt: Date;
}

export function toUserResponseDto(user: UserEntity): UserResponseDto {
  return {
    id: user.id,
    email: user.email,
    fullName: user.full_name,
    role: user.role,
    isActive: user.is_active,
    createdAt: user.created_at,
  };
}
