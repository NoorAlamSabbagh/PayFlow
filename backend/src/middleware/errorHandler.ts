import { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/errors';
import { sendError } from '../utils/response';
import { logger } from '../config/logger';
import { config } from '../config';

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction
): Response {
  if (err instanceof AppError) {
    logger.warn('Operational application error', {
      path: req.path,
      method: req.method,
      statusCode: err.statusCode,
      code: err.code,
      message: err.message,
    });
    return sendError(res, err.message, err.code, err.statusCode, err.details);
  }

  // Handle JSON parse errors from express.json()
  if ('type' in err && (err as { type: string }).type === 'entity.parse.failed') {
    return sendError(res, 'Malformed JSON payload in request body', 'INVALID_JSON', 400);
  }

  // Unexpected runtime errors - log detailed info internally
  logger.error('Unhandled internal server error', {
    path: req.path,
    method: req.method,
    error: err.message,
    stack: err.stack,
  });

  const message = config.env === 'production' ? 'Internal server error' : err.message;
  return sendError(res, message, 'INTERNAL_SERVER_ERROR', 500);
}
