import jwt, { SignOptions } from 'jsonwebtoken';
import crypto from 'crypto';
import { config } from '../config';
import { UnauthorizedError } from './errors';

export interface JwtUserPayload {
  userId: string;
  email: string;
  role: 'USER' | 'ADMIN' | 'OPERATOR';
}

/**
 * Generate short-lived stateless JWT Access Token
 */
export function generateAccessToken(payload: JwtUserPayload): string {
  const options: SignOptions = {
    expiresIn: config.jwt.accessExpiresIn as unknown as number,
    issuer: 'payflow',
  };
  return jwt.sign(payload, config.jwt.accessSecret, options);
}

/**
 * Verify and decode JWT Access Token
 */
export function verifyAccessToken(token: string): JwtUserPayload {
  try {
    const decoded = jwt.verify(token, config.jwt.accessSecret, {
      issuer: 'payflow',
    }) as JwtUserPayload;
    return decoded;
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      throw new UnauthorizedError('Access token has expired', 'TOKEN_EXPIRED');
    }
    throw new UnauthorizedError('Invalid access token', 'TOKEN_INVALID');
  }
}

/**
 * Generate cryptographically secure random string for refresh token
 */
export function generateRandomTokenString(): string {
  return crypto.randomBytes(40).toString('hex');
}

/**
 * Hash refresh token with SHA-256 before persisting in PostgreSQL
 */
export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}
