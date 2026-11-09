import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockClientQuery = vi.fn();
const mockClientRelease = vi.fn();

vi.mock('../../src/config/db', () => ({
  pool: {
    query: vi.fn(),
    connect: vi.fn(async () => ({
      query: mockClientQuery,
      release: mockClientRelease,
    })),
  },
  checkDb: vi.fn(),
  closePool: vi.fn(),
}));

vi.mock('../../src/config/env', () => ({
  env: {
    NODE_ENV: 'test',
    PORT: 3000,
    DB_HOST: 'localhost',
    DB_PORT: 5432,
    DB_NAME: 'univoice_database',
    DB_USER: 'test',
    DB_PASSWORD: 'test',
    DB_POOL_MAX: 10,
    JWT_ACCESS_SECRET: 'test_jwt_access_secret_super_secure_32chars!',
    JWT_REFRESH_SECRET: 'test_jwt_refresh_secret_super_secure_32chars!',
    JWT_ACCESS_EXPIRES_IN: '15m',
    JWT_REFRESH_EXPIRES_IN: '7d',
    COOKIE_SECURE: false,
  },
}));

import { refreshTokenRepository } from '../../src/repositories/refreshToken.repository';
import { AppError } from '../../src/utils/AppError';

describe('RefreshTokenRepository - Concurrency & Atomic Rotation', () => {
  const userId = '00000000-0000-0000-0000-000000000001';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rotates token inside a transaction with row-level locking (SELECT ... FOR UPDATE)', async () => {
    mockClientQuery.mockResolvedValueOnce({}); // BEGIN
    mockClientQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 'token-row-1',
          user_id: userId,
          expires_at: new Date(Date.now() + 60000),
          revoked_at: null,
        },
      ],
    }); // SELECT FOR UPDATE
    mockClientQuery.mockResolvedValueOnce({}); // UPDATE old token
    mockClientQuery.mockResolvedValueOnce({}); // INSERT new token
    mockClientQuery.mockResolvedValueOnce({}); // COMMIT

    const result = await refreshTokenRepository.rotateToken(
      'old-hash-1',
      'new-hash-1',
      new Date(Date.now() + 100000),
    );

    expect(result).toEqual({ userId });
    expect(mockClientQuery).toHaveBeenNthCalledWith(1, 'BEGIN');
    expect(mockClientQuery).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('FOR UPDATE'),
      ['old-hash-1'],
    );
    expect(mockClientQuery).toHaveBeenNthCalledWith(5, 'COMMIT');
    expect(mockClientRelease).toHaveBeenCalledTimes(1);
  });

  it('concurrent request arriving second detects revoked_at is not null and triggers family revocation', async () => {
    mockClientQuery.mockResolvedValueOnce({}); // BEGIN
    // Second request receives the row updated by first request (revoked_at is now set)
    mockClientQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 'token-row-1',
          user_id: userId,
          expires_at: new Date(Date.now() + 60000),
          revoked_at: new Date(Date.now() - 100), // revoked!
        },
      ],
    }); // SELECT FOR UPDATE
    mockClientQuery.mockResolvedValueOnce({}); // Family revocation UPDATE
    mockClientQuery.mockResolvedValueOnce({}); // COMMIT

    await expect(
      refreshTokenRepository.rotateToken(
        'old-hash-1',
        'new-hash-2',
        new Date(Date.now() + 100000),
      ),
    ).rejects.toThrowError(AppError);

    // Verify family revocation was executed
    expect(mockClientQuery).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE refresh_tokens'),
      [userId],
    );
    expect(mockClientRelease).toHaveBeenCalledTimes(1);
  });

  it('rolls back transaction on unexpected database error', async () => {
    mockClientQuery.mockResolvedValueOnce({}); // BEGIN
    mockClientQuery.mockRejectedValueOnce(new Error('Connection dropped')); // Error on query
    mockClientQuery.mockResolvedValueOnce({}); // ROLLBACK

    await expect(
      refreshTokenRepository.rotateToken(
        'old-hash-1',
        'new-hash-1',
        new Date(Date.now() + 100000),
      ),
    ).rejects.toThrow('Connection dropped');

    expect(mockClientQuery).toHaveBeenCalledWith('ROLLBACK');
    expect(mockClientRelease).toHaveBeenCalledTimes(1);
  });
});
