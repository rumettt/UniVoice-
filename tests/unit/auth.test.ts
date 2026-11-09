import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../../src/app';
import { hashPassword } from '../../src/services/auth/password.service';
import { hashRefreshToken } from '../../src/services/auth/token.service';

const mockQuery = vi.fn();
const mockClientQuery = vi.fn();
const mockClientRelease = vi.fn();

vi.mock('../../src/config/db', () => ({
  pool: {
    query: (...args: unknown[]) => mockQuery(...args),
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

describe('Auth Endpoints & Lifecycle', () => {
  let sampleHashedPassword: string;
  const testUserId = '00000000-0000-0000-0000-000000000001';

  beforeEach(async () => {
    vi.clearAllMocks();
    sampleHashedPassword = await hashPassword('CorrectPassword123!');
  });

  // ==========================================================================
  // POST /api/v1/auth/login
  // ==========================================================================
  describe('POST /api/v1/auth/login', () => {
    it('successfully logs in with valid credentials and returns access token + sets HttpOnly cookie', async () => {
      // Mock findByEmail query
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: testUserId,
            firstName: 'Alex',
            lastName: 'Rivera',
            fullName: 'Alex Rivera',
            email: 'student@univoice.edu',
            passwordHash: sampleHashedPassword,
            role: 'student',
            primaryDepartmentId: null,
            isActive: true,
          },
        ],
      });

      // Mock refreshTokenRepository.create query
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'token-uuid-1' }],
      });

      // Mock updateLastLogin query
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'student@univoice.edu', password: 'CorrectPassword123!' });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');
      expect(res.body.data.accessToken).toBeDefined();
      expect(res.body.data.user).toEqual({
        id: testUserId,
        firstName: 'Alex',
        lastName: 'Rivera',
        fullName: 'Alex Rivera',
        email: 'student@univoice.edu',
        role: 'student',
        primaryDepartmentId: null,
      });

      // Ensure password hash is NOT leaked
      expect(JSON.stringify(res.body)).not.toContain('passwordHash');
      expect(JSON.stringify(res.body)).not.toContain('$argon2id');

      // Check HttpOnly refresh token cookie
      const cookies = res.headers['set-cookie'];
      expect(cookies).toBeDefined();
      const cookieStr = Array.isArray(cookies) ? cookies.join(';') : cookies;
      expect(cookieStr).toContain('refreshToken=');
      expect(cookieStr.toLowerCase()).toContain('httponly');
      expect(cookieStr.toLowerCase()).toContain('samesite=strict');
    });

    it('rejects with 400 if request body fails Zod validation', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'not-an-email', password: '' });

      expect(res.status).toBe(400);
      expect(res.body.status).toBe('error');
      expect(res.body.message).toContain('Validation failed');
    });

    it('returns generic 401 when email is not found without revealing account existence', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'unknown@univoice.edu', password: 'AnyPassword123!' });

      expect(res.status).toBe(401);
      expect(res.body.message).toBe('Invalid email or password');
    });

    it('returns generic 401 when password is wrong without revealing account existence', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: testUserId,
            firstName: 'Alex',
            lastName: 'Rivera',
            fullName: 'Alex Rivera',
            email: 'student@univoice.edu',
            passwordHash: sampleHashedPassword,
            role: 'student',
            primaryDepartmentId: null,
            isActive: true,
          },
        ],
      });

      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'student@univoice.edu', password: 'WrongPassword999!' });

      expect(res.status).toBe(401);
      expect(res.body.message).toBe('Invalid email or password');
    });

    it('returns 403 when account is inactive / disabled', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: testUserId,
            firstName: 'Alex',
            lastName: 'Rivera',
            fullName: 'Alex Rivera',
            email: 'student@univoice.edu',
            passwordHash: sampleHashedPassword,
            role: 'student',
            primaryDepartmentId: null,
            isActive: false, // Disabled account
          },
        ],
      });

      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'student@univoice.edu', password: 'CorrectPassword123!' });

      expect(res.status).toBe(403);
      expect(res.body.message).toContain('Account is inactive');
    });
  });

  // ==========================================================================
  // POST /api/v1/auth/refresh
  // ==========================================================================
  describe('POST /api/v1/auth/refresh', () => {
    it('returns 401 if refresh token is missing', async () => {
      const res = await request(app).post('/api/v1/auth/refresh');

      expect(res.status).toBe(401);
      expect(res.body.message).toContain('Refresh token required');
    });

    it('successfully rotates refresh token atomically and returns new access token', async () => {
      const rawToken = 'valid-test-raw-refresh-token';
      const expiresFuture = new Date(Date.now() + 1000 * 60 * 60 * 24);

      // Client transaction queries:
      // 1. BEGIN
      mockClientQuery.mockResolvedValueOnce({});
      // 2. SELECT FOR UPDATE
      mockClientQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'old-token-id',
            user_id: testUserId,
            expires_at: expiresFuture,
            revoked_at: null,
          },
        ],
      });
      // 3. UPDATE old token (revoke)
      mockClientQuery.mockResolvedValueOnce({});
      // 4. INSERT new token
      mockClientQuery.mockResolvedValueOnce({});
      // 5. COMMIT
      mockClientQuery.mockResolvedValueOnce({});

      // userRepository.findById query
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: testUserId,
            firstName: 'Alex',
            lastName: 'Rivera',
            fullName: 'Alex Rivera',
            email: 'student@univoice.edu',
            role: 'student',
            primaryDepartmentId: null,
            isActive: true,
          },
        ],
      });

      const res = await request(app)
        .post('/api/v1/auth/refresh')
        .set('Cookie', [`refreshToken=${rawToken}`]);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');
      expect(res.body.data.accessToken).toBeDefined();

      // Check that a new rotated cookie was set
      const cookies = res.headers['set-cookie'];
      expect(cookies).toBeDefined();
      expect(cookies[0]).toContain('refreshToken=');
      expect(cookies[0]).not.toContain(rawToken); // Rotated to a new value
    });

    it('rejects and triggers family revocation when a revoked token is replayed', async () => {
      const rawToken = 'already-revoked-token';

      mockClientQuery.mockResolvedValueOnce({}); // BEGIN
      // SELECT FOR UPDATE returns a token with revoked_at != null
      mockClientQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'revoked-token-id',
            user_id: testUserId,
            expires_at: new Date(Date.now() + 10000),
            revoked_at: new Date(Date.now() - 5000), // Already revoked
          },
        ],
      });
      // Family revocation query
      mockClientQuery.mockResolvedValueOnce({});
      mockClientQuery.mockResolvedValueOnce({}); // COMMIT

      const res = await request(app)
        .post('/api/v1/auth/refresh')
        .set('Cookie', [`refreshToken=${rawToken}`]);

      expect(res.status).toBe(401);
      expect(res.body.message).toContain('suspicious activity');

      // Verify family revocation was executed
      expect(mockClientQuery).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE refresh_tokens'),
        expect.arrayContaining([testUserId]),
      );
    });

    it('rejects with 401 when refresh token is expired', async () => {
      const rawToken = 'expired-token';

      mockClientQuery.mockResolvedValueOnce({}); // BEGIN
      mockClientQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'expired-token-id',
            user_id: testUserId,
            expires_at: new Date(Date.now() - 1000), // Expired in the past
            revoked_at: null,
          },
        ],
      });
      mockClientQuery.mockResolvedValueOnce({}); // ROLLBACK

      const res = await request(app)
        .post('/api/v1/auth/refresh')
        .set('Cookie', [`refreshToken=${rawToken}`]);

      expect(res.status).toBe(401);
      expect(res.body.message).toContain('expired');
    });
  });

  // ==========================================================================
  // POST /api/v1/auth/logout
  // ==========================================================================
  describe('POST /api/v1/auth/logout', () => {
    it('revokes the refresh token and clears the cookie', async () => {
      const rawToken = 'logout-raw-token';
      mockQuery.mockResolvedValueOnce({ rowCount: 1 });

      const res = await request(app)
        .post('/api/v1/auth/logout')
        .set('Cookie', [`refreshToken=${rawToken}`]);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');
      expect(res.body.message).toContain('Logged out successfully');

      // Check DB was updated with the token's hash
      const expectedHash = hashRefreshToken(rawToken);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE refresh_tokens'),
        expect.arrayContaining([expectedHash]),
      );

      // Check cookie was cleared (expires in past)
      const cookies = res.headers['set-cookie'];
      expect(cookies).toBeDefined();
      const cookieStr = Array.isArray(cookies) ? cookies.join(';') : cookies;
      expect(cookieStr).toContain('refreshToken=;');
    });
  });

  // ==========================================================================
  // GET /api/v1/auth/me
  // ==========================================================================
  describe('GET /api/v1/auth/me', () => {
    it('returns 401 when Authorization header is missing', async () => {
      const res = await request(app).get('/api/v1/auth/me');

      expect(res.status).toBe(401);
      expect(res.body.message).toContain('Missing token');
    });

    it('returns 401 when Authorization header does not use Bearer scheme', async () => {
      const res = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', 'Basic 123456');

      expect(res.status).toBe(401);
      expect(res.body.message).toContain('Invalid authorization header format');
    });

    it('returns 401 when token is invalid or signature fails', async () => {
      const res = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', 'Bearer invalid.token.value');

      expect(res.status).toBe(401);
      expect(res.body.message).toContain('Invalid access token');
    });

    it('returns 401 when token is expired', async () => {
      const expiredToken = jwt.sign(
        { sub: testUserId, email: 'student@univoice.edu', role: 'student' },
        'test_jwt_access_secret_super_secure_32chars!',
        { expiresIn: '-1s' },
      );

      const res = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${expiredToken}`);

      expect(res.status).toBe(401);
      expect(res.body.message).toBe('Access token expired');
    });

    it('returns 403 when authenticated user is deactivated in the database', async () => {
      const validToken = jwt.sign(
        { sub: testUserId, email: 'student@univoice.edu', role: 'student' },
        'test_jwt_access_secret_super_secure_32chars!',
        { expiresIn: '15m' },
      );

      // DB returns inactive user
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: testUserId,
            firstName: 'Alex',
            lastName: 'Rivera',
            fullName: 'Alex Rivera',
            email: 'student@univoice.edu',
            role: 'student',
            primaryDepartmentId: null,
            isActive: false, // Deactivated!
          },
        ],
      });

      const res = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${validToken}`);

      expect(res.status).toBe(403);
      expect(res.body.message).toContain('deactivated');
    });

    it('returns 200 with safe user profile for a valid active token', async () => {
      const validToken = jwt.sign(
        { sub: testUserId, email: 'student@univoice.edu', role: 'student' },
        'test_jwt_access_secret_super_secure_32chars!',
        { expiresIn: '15m' },
      );

      // DB returns active user
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: testUserId,
            firstName: 'Alex',
            lastName: 'Rivera',
            fullName: 'Alex Rivera',
            email: 'student@univoice.edu',
            role: 'student',
            primaryDepartmentId: null,
            isActive: true,
          },
        ],
      });

      const res = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${validToken}`);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');
      expect(res.body.data.user).toEqual({
        id: testUserId,
        firstName: 'Alex',
        lastName: 'Rivera',
        fullName: 'Alex Rivera',
        email: 'student@univoice.edu',
        role: 'student',
        primaryDepartmentId: null,
      });
    });
  });
});
