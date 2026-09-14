import { Request, Response, NextFunction } from 'express';
import { authService, AuthService } from './auth.service';
import { sendSuccess } from '../../utils/response';
import { config } from '../../config';
import { UnauthorizedError } from '../../utils/errors';

export class AuthController {
  constructor(private service: AuthService = authService) {}

  private setRefreshTokenCookie(res: Response, token: string): void {
    res.cookie('refreshToken', token, {
      httpOnly: true,
      secure: config.cookies.secure,
      sameSite: config.cookies.sameSite,
      maxAge: config.jwt.refreshExpiresInDays * 24 * 60 * 60 * 1000,
      path: '/api/v1/auth',
    });
  }

  private clearRefreshTokenCookie(res: Response): void {
    res.clearCookie('refreshToken', {
      httpOnly: true,
      secure: config.cookies.secure,
      sameSite: config.cookies.sameSite,
      path: '/api/v1/auth',
    });
  }

  register = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.service.register(req.body);
      this.setRefreshTokenCookie(res, result.refreshToken);

      sendSuccess(
        res,
        {
          user: result.user,
          accessToken: result.accessToken,
        },
        'User registered successfully',
        201
      );
    } catch (error) {
      next(error);
    }
  };

  login = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.service.login(req.body);
      this.setRefreshTokenCookie(res, result.refreshToken);

      sendSuccess(
        res,
        {
          user: result.user,
          accessToken: result.accessToken,
        },
        'User logged in successfully',
        200
      );
    } catch (error) {
      next(error);
    }
  };

  refresh = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      // Support both HttpOnly cookie and optional body parameter for headless/cURL testing
      const rawToken = req.cookies?.refreshToken || req.body?.refreshToken;

      if (!rawToken) {
        throw new UnauthorizedError('No refresh token provided', 'REFRESH_TOKEN_REQUIRED');
      }

      const result = await this.service.refreshTokens(rawToken);
      this.setRefreshTokenCookie(res, result.refreshToken);

      sendSuccess(
        res,
        {
          user: result.user,
          accessToken: result.accessToken,
        },
        'Token refreshed successfully',
        200
      );
    } catch (error) {
      next(error);
    }
  };

  logout = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const rawToken = req.cookies?.refreshToken || req.body?.refreshToken;
      await this.service.logout(rawToken);
      this.clearRefreshTokenCookie(res);

      sendSuccess(res, null, 'Logged out successfully', 200);
    } catch (error) {
      next(error);
    }
  };
}

export const authController = new AuthController();
