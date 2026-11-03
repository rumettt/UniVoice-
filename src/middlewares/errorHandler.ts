import { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/AppError';
import { env } from '../config/env';

/** Catches requests to routes that were not matched. */
export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    status: 'error',
    message: `Route not found: ${req.method} ${req.originalUrl}`,
  });
}

/**
 * Centralized error-handling middleware.
 * - Operational errors (AppError): return the error message and status code.
 * - Unknown errors: log internally, return a generic 500 in production.
 */
export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction,
): void {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      status: 'error',
      message: err.message,
    });
    return;
  }

  // Unknown / programming error
  const message =
    err instanceof Error ? err.message : 'An unexpected error occurred';

  console.error('[error]', err);

  res.status(500).json({
    status: 'error',
    message:
      env.NODE_ENV === 'production' ? 'Internal server error' : message,
  });
}
