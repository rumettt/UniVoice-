import { Request, Response } from 'express';
import { env } from '../config/env';
import { loginSchema } from '../validators/auth.validators';
import { userRepository } from '../repositories/user.repository';
import { refreshTokenRepository } from '../repositories/refreshToken.repository';
import { verifyPassword } from '../services/auth/password.service';
import {
  signAccessToken,
  generateRefreshToken,
  hashRefreshToken,
  calculateExpiryDate,
} from '../services/auth/token.service';
import { AppError } from '../utils/AppError';

export const REFRESH_COOKIE_NAME = 'refreshToken';

export function getRefreshCookieOptions() {
  return {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: 'strict' as const,
    path: '/api/v1/auth',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days in ms
  };
}

export function getClearCookieOptions() {
  return {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: 'strict' as const,
    path: '/api/v1/auth',
  };
}

/**
 * POST /api/v1/auth/login
 * Verifies credentials, checks active status, records login timestamp,
 * generates JWT access token and secure HttpOnly refresh token.
 */
export async function login(req: Request, res: Response): Promise<void> {
  const parseResult = loginSchema.safeParse(req.body);
  if (!parseResult.success) {
    const errorMsg = parseResult.error.issues
      .map((i) => i.message)
      .join(', ');
    throw new AppError(`Validation failed: ${errorMsg}`, 400);
  }

  const { email, password } = parseResult.data;

  const user = await userRepository.findByEmail(email);

  // Use constant-time dummy verification if user is not found to defend against timing attacks
  if (!user) {
    await verifyPassword(
      '$argon2id$v=19$m=65536,t=3,p=4$dummyhashdummypaddedstringforargontiming$dummyhash',
      password,
    );
    throw new AppError('Invalid email or password', 401);
  }

  const isPasswordValid = await verifyPassword(user.passwordHash, password);
  if (!isPasswordValid) {
    throw new AppError('Invalid email or password', 401);
  }

  if (!user.isActive) {
    throw new AppError(
      'Account is inactive. Please contact your administrator.',
      403,
    );
  }

  // Issue tokens
  const accessToken = signAccessToken({
    sub: user.id,
    email: user.email,
    role: user.role,
  });

  const rawRefreshToken = generateRefreshToken();
  const tokenHash = hashRefreshToken(rawRefreshToken);
  const expiresAt = calculateExpiryDate(env.JWT_REFRESH_EXPIRES_IN);

  // Store only the hash in the database
  await refreshTokenRepository.create(user.id, tokenHash, expiresAt);

  // Update last login timestamp asynchronously
  await userRepository.updateLastLogin(user.id);

  // Set secure HttpOnly cookie for refresh token
  res.cookie(REFRESH_COOKIE_NAME, rawRefreshToken, getRefreshCookieOptions());

  res.status(200).json({
    status: 'success',
    data: {
      accessToken,
      user: {
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        fullName: user.fullName,
        email: user.email,
        role: user.role,
        primaryDepartmentId: user.primaryDepartmentId,
      },
    },
  });
}

/**
 * POST /api/v1/auth/refresh
 * Rotates the refresh token atomically with replay attack detection,
 * issuing a new access token and setting a new refresh token cookie.
 */
export async function refresh(req: Request, res: Response): Promise<void> {
  const rawRefreshToken =
    req.cookies?.[REFRESH_COOKIE_NAME] || req.body?.refreshToken;

  if (!rawRefreshToken || typeof rawRefreshToken !== 'string') {
    throw new AppError('Refresh token required', 401);
  }

  const oldTokenHash = hashRefreshToken(rawRefreshToken);
  const newRawRefreshToken = generateRefreshToken();
  const newTokenHash = hashRefreshToken(newRawRefreshToken);
  const newExpiresAt = calculateExpiryDate(env.JWT_REFRESH_EXPIRES_IN);

  // Atomically rotates the token and detects potential replay attacks
  const { userId } = await refreshTokenRepository.rotateToken(
    oldTokenHash,
    newTokenHash,
    newExpiresAt,
  );

  const user = await userRepository.findById(userId);
  if (!user || !user.isActive) {
    throw new AppError('User account is inactive or no longer exists', 401);
  }

  const accessToken = signAccessToken({
    sub: user.id,
    email: user.email,
    role: user.role,
  });

  res.cookie(
    REFRESH_COOKIE_NAME,
    newRawRefreshToken,
    getRefreshCookieOptions(),
  );

  res.status(200).json({
    status: 'success',
    data: {
      accessToken,
    },
  });
}

/**
 * POST /api/v1/auth/logout
 * Revokes the presented refresh token and clears the cookie.
 */
export async function logout(req: Request, res: Response): Promise<void> {
  const rawRefreshToken =
    req.cookies?.[REFRESH_COOKIE_NAME] || req.body?.refreshToken;

  if (rawRefreshToken && typeof rawRefreshToken === 'string') {
    const tokenHash = hashRefreshToken(rawRefreshToken);
    await refreshTokenRepository.revokeByHash(tokenHash);
  }

  res.clearCookie(REFRESH_COOKIE_NAME, getClearCookieOptions());

  res.status(200).json({
    status: 'success',
    message: 'Logged out successfully',
  });
}

/**
 * GET /api/v1/auth/me
 * Returns the currently authenticated user's safe profile.
 */
export function me(req: Request, res: Response): void {
  // req.user is guaranteed by authenticate middleware
  res.status(200).json({
    status: 'success',
    data: {
      user: req.user,
    },
  });
}
