import { Request, Response, NextFunction } from 'express';

/**
 * Logs each HTTP request: method, URL, status code, and response time.
 * Sensitive headers (Authorization, Cookie, Set-Cookie) are never logged.
 */
export function requestLogger(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const startedAt = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - startedAt;
    console.log(
      `[http] ${req.method} ${req.originalUrl} ${res.statusCode} — ${duration}ms`,
    );
  });

  next();
}
