/**
 * Represents a known, operational error (e.g. validation failure, not found).
 * The centralized error handler uses `isOperational` to decide whether to
 * expose the message to clients or return a generic server-error response.
 */
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly isOperational: boolean;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}
