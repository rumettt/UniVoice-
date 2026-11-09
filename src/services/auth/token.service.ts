import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { env } from '../../config/env';
import { JwtAccessTokenPayload, UserRole } from '../../types/auth';
import { AppError } from '../../utils/AppError';

/**
 * Signs a short-lived access token with HMAC-SHA256.
 */
export function signAccessToken(payload: {
  sub: string;
  email: string;
  role: UserRole;
}): string {
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    expiresIn: env.JWT_ACCESS_EXPIRES_IN as jwt.SignOptions['expiresIn'],
    algorithm: 'HS256',
  });
}

/**
 * Verifies and decodes a JWT access token.
 * Throws AppError(401) on invalid signature, expiration, or malformed token.
 */
export function verifyAccessToken(token: string): JwtAccessTokenPayload {
  try {
    return jwt.verify(token, env.JWT_ACCESS_SECRET, {
      algorithms: ['HS256'],
    }) as JwtAccessTokenPayload;
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      throw new AppError('Access token expired', 401);
    }
    throw new AppError('Invalid access token', 401);
  }
}

/**
 * Generates an unguessable cryptographically secure random string for refresh token.
 */
export function generateRefreshToken(): string {
  return crypto.randomBytes(48).toString('base64url');
}

/**
 * Computes deterministic SHA-256 hash of a refresh token.
 * Only this hash is stored in the database.
 */
export function hashRefreshToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Parses duration strings like '7d', '24h', '15m' into an absolute Date in the future.
 */
export function calculateExpiryDate(duration: string): Date {
  const match = duration.match(/^(\d+)([smhd])$/);
  if (!match) {
    // Default 7 days
    return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  }
  const amount = parseInt(match[1], 10);
  const unit = match[2];
  let ms = 0;
  switch (unit) {
    case 's':
      ms = amount * 1000;
      break;
    case 'm':
      ms = amount * 60 * 1000;
      break;
    case 'h':
      ms = amount * 60 * 60 * 1000;
      break;
    case 'd':
      ms = amount * 24 * 60 * 60 * 1000;
      break;
    default:
      ms = 7 * 24 * 60 * 60 * 1000;
  }
  return new Date(Date.now() + ms);
}
