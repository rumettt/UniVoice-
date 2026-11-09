import { pool } from '../config/db';
import { AppError } from '../utils/AppError';

export interface RefreshTokenRecord {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
}

export class RefreshTokenRepository {
  /**
   * Inserts a new hashed refresh token.
   * Plaintext tokens are NEVER stored.
   */
  async create(
    userId: string,
    tokenHash: string,
    expiresAt: Date,
  ): Promise<string> {
    const query = `
      INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
      VALUES ($1, $2, $3)
      RETURNING id;
    `;
    const result = await pool.query(query, [userId, tokenHash, expiresAt]);
    return result.rows[0].id as string;
  }

  /**
   * Revokes a specific refresh token by its hash (used on explicit logout).
   */
  async revokeByHash(tokenHash: string): Promise<boolean> {
    const query = `
      UPDATE refresh_tokens
      SET revoked_at = NOW()
      WHERE token_hash = $1 AND revoked_at IS NULL;
    `;
    const result = await pool.query(query, [tokenHash]);
    return (result.rowCount ?? 0) > 0;
  }

  /**
   * Revokes all active refresh tokens for a user.
   * Invoked upon detecting a token replay attack.
   */
  async revokeAllForUser(userId: string): Promise<void> {
    const query = `
      UPDATE refresh_tokens
      SET revoked_at = NOW()
      WHERE user_id = $1 AND revoked_at IS NULL;
    `;
    await pool.query(query, [userId]);
  }

  /**
   * Atomically validates, revokes the presented refresh token, and stores the new rotated token.
   * Uses row-level locking (SELECT ... FOR UPDATE) inside a transaction.
   * If a revoked token is re-submitted (concurrent or delayed replay), all active tokens
   * for that user family are immediately revoked.
   */
  async rotateToken(
    oldTokenHash: string,
    newTokenHash: string,
    newExpiresAt: Date,
  ): Promise<{ userId: string }> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Row-level lock ensures concurrent refresh attempts for the same token serialize
      const selectRes = await client.query(
        `SELECT id, user_id, expires_at, revoked_at
         FROM refresh_tokens
         WHERE token_hash = $1
         FOR UPDATE`,
        [oldTokenHash],
      );

      if (selectRes.rows.length === 0) {
        await client.query('ROLLBACK');
        throw new AppError('Invalid refresh token', 401);
      }

      const tokenRow = selectRes.rows[0];
      const userId = tokenRow.user_id as string;

      // Replay Detection: If token is already revoked, an adversary or stale client is replaying it
      if (tokenRow.revoked_at !== null) {
        // Family revocation: revoke all active tokens for this user
        await client.query(
          `UPDATE refresh_tokens
           SET revoked_at = NOW()
           WHERE user_id = $1 AND revoked_at IS NULL`,
          [userId],
        );
        await client.query('COMMIT');
        throw new AppError(
          'Invalid refresh token: suspicious activity detected and all active sessions were revoked',
          401,
        );
      }

      // Check expiration
      if (new Date(tokenRow.expires_at).getTime() <= Date.now()) {
        await client.query('ROLLBACK');
        throw new AppError('Refresh token expired', 401);
      }

      // Revoke the old token atomically
      await client.query(
        `UPDATE refresh_tokens
         SET revoked_at = NOW()
         WHERE id = $1`,
        [tokenRow.id],
      );

      // Insert new rotated token
      await client.query(
        `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
         VALUES ($1, $2, $3)`,
        [userId, newTokenHash, newExpiresAt],
      );

      await client.query('COMMIT');
      return { userId };
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // Rollback attempt might fail if connection closed or already committed
      }
      throw err;
    } finally {
      client.release();
    }
  }
}

export const refreshTokenRepository = new RefreshTokenRepository();
