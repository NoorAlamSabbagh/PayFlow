import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { userRepository, UserRepository } from '../user/user.repository';
import { refreshTokenRepository, RefreshTokenRepository } from './refresh-token.repository';
import { RegisterInput, LoginInput, AuthTokens, AuthResultDto } from './auth.types';
import { toUserResponseDto } from '../user/user.types';
import { generateAccessToken, generateRandomTokenString, hashToken } from '../../utils/token';
import { ConflictError, UnauthorizedError, ForbiddenError } from '../../utils/errors';
import { config } from '../../config';
import { logger } from '../../config/logger';
import { getClient } from '../../database';

export class AuthService {
  constructor(
    private userRepo: UserRepository = userRepository,
    private tokenRepo: RefreshTokenRepository = refreshTokenRepository
  ) {}

  /**
   * Register a new user and issue initial tokens
   */
  async register(input: RegisterInput): Promise<AuthResultDto & { refreshToken: string }> {
    const existing = await this.userRepo.findByEmail(input.email);
    if (existing) {
      throw new ConflictError('Email is already registered', 'EMAIL_ALREADY_EXISTS');
    }

    const saltRounds = 12;
    const passwordHash = await bcrypt.hash(input.password, saltRounds);

    const user = await this.userRepo.createUser({
      email: input.email,
      passwordHash,
      fullName: input.fullName,
      role: input.role,
    });

    const tokens = await this.issueTokenPair(user.id, user.email, user.role, uuidv4());

    logger.info('User successfully registered', { userId: user.id, role: user.role });

    return {
      user: toUserResponseDto(user),
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    };
  }

  /**
   * Authenticate user with credentials and issue fresh token family
   */
  async login(input: LoginInput): Promise<AuthResultDto & { refreshToken: string }> {
    const user = await this.userRepo.findByEmail(input.email);
    if (!user) {
      throw new UnauthorizedError('Invalid email or password', 'INVALID_CREDENTIALS');
    }

    const isMatch = await bcrypt.compare(input.password, user.password_hash);
    if (!isMatch) {
      throw new UnauthorizedError('Invalid email or password', 'INVALID_CREDENTIALS');
    }

    if (!user.is_active) {
      throw new ForbiddenError('Your account has been deactivated', 'ACCOUNT_DEACTIVATED');
    }

    const familyId = uuidv4();
    const tokens = await this.issueTokenPair(user.id, user.email, user.role, familyId);

    logger.info('User logged in successfully', { userId: user.id, role: user.role });

    return {
      user: toUserResponseDto(user),
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    };
  }

  /**
   * Rotate Refresh Token with Automatic Token Family Replay Detection
   */
  async refreshTokens(rawRefreshToken: string): Promise<AuthResultDto & { refreshToken: string }> {
    const hashed = hashToken(rawRefreshToken);
    const existingToken = await this.tokenRepo.findTokenByHash(hashed);

    if (!existingToken) {
      throw new UnauthorizedError('Invalid or unrecognized refresh token', 'INVALID_REFRESH_TOKEN');
    }

    // CRITICAL SECURITY FEATURE: Token Replay Detection
    // If an already-revoked token is submitted, an adversary or intercepted token is being replayed!
    if (existingToken.is_revoked) {
      logger.error('SECURITY ALERT: Refresh token reuse detected! Revoking entire token family.', {
        userId: existingToken.user_id,
        familyId: existingToken.family_id,
      });

      // Immediately revoke all active tokens in this family to protect the compromised user
      await this.tokenRepo.revokeFamily(existingToken.family_id);

      throw new UnauthorizedError(
        'Compromised refresh token reused. All active sessions in this family have been terminated.',
        'TOKEN_FAMILY_COMPROMISED'
      );
    }

    // Check expiration
    if (new Date() > new Date(existingToken.expires_at)) {
      throw new UnauthorizedError('Refresh token has expired, please log in again', 'REFRESH_TOKEN_EXPIRED');
    }

    const user = await this.userRepo.findById(existingToken.user_id);
    if (!user || !user.is_active) {
      throw new UnauthorizedError('User account not found or inactive', 'USER_INACTIVE');
    }

    // Perform atomic rotation inside a dedicated database transaction
    const client = await getClient();
    try {
      await client.query('BEGIN');

      // 1. Revoke the presented refresh token
      await this.tokenRepo.revokeToken(existingToken.id, client);

      // 2. Generate new refresh token in the SAME family
      const newRefreshTokenString = generateRandomTokenString();
      const newHashed = hashToken(newRefreshTokenString);
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + config.jwt.refreshExpiresInDays);

      await this.tokenRepo.createRefreshToken(
        {
          userId: user.id,
          tokenHash: newHashed,
          familyId: existingToken.family_id,
          expiresAt,
        },
        client
      );

      await client.query('COMMIT');

      // 3. Issue fresh access token
      const accessToken = generateAccessToken({
        userId: user.id,
        email: user.email,
        role: user.role,
      });

      logger.debug('Refresh token rotated successfully', {
        userId: user.id,
        familyId: existingToken.family_id,
      });

      return {
        user: toUserResponseDto(user),
        accessToken,
        refreshToken: newRefreshTokenString,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Log out and revoke active refresh token
   */
  async logout(rawRefreshToken?: string): Promise<void> {
    if (!rawRefreshToken) return;

    try {
      const hashed = hashToken(rawRefreshToken);
      const token = await this.tokenRepo.findTokenByHash(hashed);
      if (token && !token.is_revoked) {
        await this.tokenRepo.revokeToken(token.id);
        logger.info('User session logged out and refresh token revoked', {
          userId: token.user_id,
          familyId: token.family_id,
        });
      }
    } catch (err) {
      logger.warn('Failed to revoke refresh token during logout', { error: (err as Error).message });
    }
  }

  /**
   * Internal helper: Issues token pair and saves refresh token to database
   */
  private async issueTokenPair(
    userId: string,
    email: string,
    role: 'USER' | 'ADMIN' | 'OPERATOR',
    familyId: string
  ): Promise<AuthTokens> {
    const accessToken = generateAccessToken({ userId, email, role });
    const refreshTokenString = generateRandomTokenString();
    const tokenHash = hashToken(refreshTokenString);

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + config.jwt.refreshExpiresInDays);

    await this.tokenRepo.createRefreshToken({
      userId,
      tokenHash,
      familyId,
      expiresAt,
    });

    return {
      accessToken,
      refreshToken: refreshTokenString,
    };
  }
}

export const authService = new AuthService();
