import { Request, Response, NextFunction } from 'express';
import { UserRole } from '../modules/user/user.types';
import { ForbiddenError, UnauthorizedError } from '../utils/errors';

export function requireRole(...allowedRoles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      return next(new UnauthorizedError('Authentication required prior to authorization check', 'AUTHENTICATION_REQUIRED'));
    }

    if (!allowedRoles.includes(req.user.role)) {
      return next(
        new ForbiddenError(
          `Forbidden. Requires one of roles: [${allowedRoles.join(', ')}], current role is: ${req.user.role}`,
          'INSUFFICIENT_PERMISSIONS'
        )
      );
    }

    next();
  };
}
