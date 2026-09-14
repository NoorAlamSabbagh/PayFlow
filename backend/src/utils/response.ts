import { Response } from 'express';

export interface ApiResponse<T = unknown> {
  success: boolean;
  message: string;
  data?: T;
  error?: {
    code: string;
    details?: unknown;
  };
}

export function sendSuccess<T>(
  res: Response,
  data: T,
  message = 'Success',
  statusCode = 200
): Response {
  const payload: ApiResponse<T> = {
    success: true,
    message,
    data,
  };
  return res.status(statusCode).json(payload);
}

export function sendError(
  res: Response,
  message: string,
  code: string,
  statusCode = 500,
  details?: unknown
): Response {
  const payload: ApiResponse = {
    success: false,
    message,
    error: {
      code,
      ...(details ? { details } : {}),
    },
  };
  return res.status(statusCode).json(payload);
}
