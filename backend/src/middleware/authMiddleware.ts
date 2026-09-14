import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken, JwtUserPayload } from '../utils/token';
import { UnauthorizedError } from '../utils/errors';

// Extend Express Request definition
declare global {
  namespace Express {
    interface Request {
      user?: JwtUserPayload;
    }
  }
}

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next(new UnauthorizedError('Authentication required. Missing or malformed Bearer token', 'AUTHENTICATION_REQUIRED'));
  }

  const token = authHeader.split(' ')[1];
  try {
    const payload = verifyAccessToken(token);
    req.user = payload;
    next();
  } catch (error) {
    next(error);
  }
}
