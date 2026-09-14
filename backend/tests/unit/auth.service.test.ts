import bcrypt from 'bcryptjs';
import { AuthService } from '../../src/modules/auth/auth.service';
import { UserRepository } from '../../src/modules/user/user.repository';
import { RefreshTokenRepository } from '../../src/modules/auth/refresh-token.repository';
import { ConflictError, UnauthorizedError } from '../../src/utils/errors';
import { UserEntity } from '../../src/modules/user/user.types';
import { RefreshTokenEntity } from '../../src/modules/auth/auth.types';

import { WalletRepository } from '../../src/modules/wallet/wallet.repository';
import { WalletEntity } from '../../src/modules/wallet/wallet.types';

// Mock getClient and transaction methods from database
jest.mock('../../src/database', () => ({
  getClient: jest.fn().mockResolvedValue({
    query: jest.fn().mockResolvedValue({ rows: [] }),
    release: jest.fn(),
  }),
  query: jest.fn(),
}));

describe('AuthService Unit Tests', () => {
  let authService: AuthService;
  let mockUserRepo: jest.Mocked<UserRepository>;
  let mockTokenRepo: jest.Mocked<RefreshTokenRepository>;
  let mockWalletRepo: jest.Mocked<WalletRepository>;

  const mockUser: UserEntity = {
    id: '11111111-1111-1111-1111-111111111111',
    email: 'alice@payflow.internal',
    password_hash: '',
    full_name: 'Alice Walker',
    role: 'USER',
    is_active: true,
    created_at: new Date(),
    updated_at: new Date(),
  };

  beforeAll(async () => {
    mockUser.password_hash = await bcrypt.hash('AlicePass123', 10);
  });

  beforeEach(() => {
    mockUserRepo = {
      findByEmail: jest.fn(),
      findById: jest.fn(),
      createUser: jest.fn(),
    } as unknown as jest.Mocked<UserRepository>;

    mockTokenRepo = {
      createRefreshToken: jest.fn(),
      findTokenByHash: jest.fn(),
      revokeToken: jest.fn(),
      revokeFamily: jest.fn(),
      revokeAllUserTokens: jest.fn(),
    } as unknown as jest.Mocked<RefreshTokenRepository>;

    mockWalletRepo = {
      createWallet: jest.fn().mockResolvedValue({} as WalletEntity),
      findByUserId: jest.fn(),
      findById: jest.fn(),
      findAndLockWallets: jest.fn(),
      updateBalance: jest.fn(),
    } as unknown as jest.Mocked<WalletRepository>;

    authService = new AuthService(mockUserRepo, mockTokenRepo, mockWalletRepo);
  });

  describe('Registration', () => {
    it('should register a new user and issue token pair', async () => {
      mockUserRepo.findByEmail.mockResolvedValue(null);
      mockUserRepo.createUser.mockResolvedValue(mockUser);
      mockTokenRepo.createRefreshToken.mockResolvedValue({} as RefreshTokenEntity);

      const result = await authService.register({
        email: 'alice@payflow.internal',
        password: 'Password123',
        fullName: 'Alice Walker',
        role: 'USER',
      });

      expect(result.user.email).toBe('alice@payflow.internal');
      expect(result.accessToken).toBeDefined();
      expect(result.refreshToken).toBeDefined();
      expect(mockUserRepo.createUser).toHaveBeenCalled();
      expect(mockWalletRepo.createWallet).toHaveBeenCalled();
      expect(mockTokenRepo.createRefreshToken).toHaveBeenCalled();
    });

    it('should throw ConflictError if email is already in use', async () => {
      mockUserRepo.findByEmail.mockResolvedValue(mockUser);

      await expect(
        authService.register({
          email: 'alice@payflow.internal',
          password: 'Password123',
          fullName: 'Alice Walker',
          role: 'USER',
        })
      ).rejects.toThrow(ConflictError);
    });
  });

  describe('Login', () => {
    it('should authenticate valid credentials and issue tokens', async () => {
      mockUserRepo.findByEmail.mockResolvedValue(mockUser);
      mockTokenRepo.createRefreshToken.mockResolvedValue({} as RefreshTokenEntity);

      const result = await authService.login({
        email: 'alice@payflow.internal',
        password: 'AlicePass123',
      });

      expect(result.user.id).toBe(mockUser.id);
      expect(result.accessToken).toBeDefined();
      expect(result.refreshToken).toBeDefined();
    });

    it('should reject invalid password with UnauthorizedError', async () => {
      mockUserRepo.findByEmail.mockResolvedValue(mockUser);

      await expect(
        authService.login({
          email: 'alice@payflow.internal',
          password: 'WrongPassword',
        })
      ).rejects.toThrow(UnauthorizedError);
    });
  });

  describe('Refresh Token Rotation & Replay Detection', () => {
    it('should rotate token if valid and unrevoked', async () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 7);

      const validToken: RefreshTokenEntity = {
        id: 'token-uuid-1',
        user_id: mockUser.id,
        token_hash: 'hash1',
        family_id: 'family-uuid-1',
        is_revoked: false,
        expires_at: futureDate,
        created_at: new Date(),
      };

      mockTokenRepo.findTokenByHash.mockResolvedValue(validToken);
      mockUserRepo.findById.mockResolvedValue(mockUser);
      mockTokenRepo.createRefreshToken.mockResolvedValue({} as RefreshTokenEntity);

      const result = await authService.refreshTokens('some-raw-token');

      expect(result.accessToken).toBeDefined();
      expect(result.refreshToken).toBeDefined();
      expect(mockTokenRepo.revokeToken).toHaveBeenCalledWith('token-uuid-1', expect.anything());
    });

    it('CRITICAL SECURITY: should detect replay of revoked token, revoke entire family, and throw', async () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 7);

      const alreadyRevokedToken: RefreshTokenEntity = {
        id: 'compromised-token-uuid',
        user_id: mockUser.id,
        token_hash: 'compromised-hash',
        family_id: 'target-compromised-family-uuid',
        is_revoked: true, // ALREADY REVOKED!
        expires_at: futureDate,
        created_at: new Date(),
      };

      mockTokenRepo.findTokenByHash.mockResolvedValue(alreadyRevokedToken);

      await expect(authService.refreshTokens('attacker-replayed-token')).rejects.toThrow(
        UnauthorizedError
      );

      // Verify that the whole family was revoked
      expect(mockTokenRepo.revokeFamily).toHaveBeenCalledWith('target-compromised-family-uuid');
    });
  });
});
