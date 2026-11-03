import { Request, Response, NextFunction } from 'express';

/**
 * Wraps an async route handler so that any rejected promise is forwarded
 * to Express's next(err) without requiring a try/catch in every handler.
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res, next).catch(next);
  };
}
