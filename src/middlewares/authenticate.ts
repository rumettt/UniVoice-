import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from '../services/auth/token.service';
import { userRepository } from '../repositories/user.repository';
import { AppError } from '../utils/AppError';

/**
 * Middleware that authenticates incoming requests using a Bearer JWT access token.
 * Extracts the token, verifies the cryptographic signature and expiration, and fetches
 * the trusted user identity from the database.
 */
export async function authenticate(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return next(new AppError('Authentication required. Missing token.', 401));
  }

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return next(
      new AppError(
        'Invalid authorization header format. Expected "Bearer <token>".',
        401,
      ),
    );
  }

  const token = parts[1];

  try {
    const payload = verifyAccessToken(token);

    // Always fetch trusted state from database to ensure account is active and role is up-to-date
    const user = await userRepository.findById(payload.sub);

    if (!user) {
      return next(new AppError('User account not found', 401));
    }

    if (!user.isActive) {
      return next(new AppError('User account has been deactivated', 403));
    }

    req.user = {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      fullName: user.fullName,
      email: user.email,
      role: user.role,
      primaryDepartmentId: user.primaryDepartmentId,
    };

    next();
  } catch (error) {
    next(error);
  }
}
