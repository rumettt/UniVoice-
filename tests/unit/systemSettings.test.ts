import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../src/app';
import { signAccessToken } from '../../src/services/auth/token.service';
import { userRepository } from '../../src/repositories/user.repository';
import { systemSettingsRepository } from '../../src/repositories/systemSettings.repository';

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

describe('System Settings Endpoints (Phase 6)', () => {
  const adminId = 'a0000000-0000-4000-8000-000000000099';
  const staffId = 'a0000000-0000-4000-8000-000000000020';
  const studentId = 'a0000000-0000-4000-8000-000000000001';

  let adminToken: string;
  let staffToken: string;
  let studentToken: string;

  beforeEach(() => {
    vi.clearAllMocks();

    adminToken = signAccessToken({
      sub: adminId,
      email: 'admin@univoice.edu',
      role: 'admin',
    });

    staffToken = signAccessToken({
      sub: staffId,
      email: 'staff@univoice.edu',
      role: 'staff',
    });

    studentToken = signAccessToken({
      sub: studentId,
      email: 'student@univoice.edu',
      role: 'student',
    });

    vi.spyOn(userRepository, 'findById').mockImplementation(async (id: string) => ({
      id,
      email: 'test@univoice.edu',
      role: id === adminId ? 'admin' : id === staffId ? 'staff' : 'student',
      isActive: true,
      firstName: 'Test',
      lastName: 'User',
      fullName: 'Test User',
      createdAt: new Date(),
      updatedAt: new Date(),
    }));
  });

  describe('GET /api/v1/admin/settings/request-workflow', () => {
    it('1. an administrator can retrieve current workflow settings', async () => {
      vi.spyOn(systemSettingsRepository, 'getWorkflowSettings').mockResolvedValueOnce({
        reopenWindowDays: 7,
        maxReopenCount: 2,
      });

      const res = await request(app)
        .get('/api/v1/admin/settings/request-workflow')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');
      expect(res.body.data.reopenWindowDays).toBe(7);
      expect(res.body.data.maxReopenCount).toBe(2);
    });

    it('2. non-admin users (staff, student) are rejected with 403', async () => {
      const staffRes = await request(app)
        .get('/api/v1/admin/settings/request-workflow')
        .set('Authorization', `Bearer ${staffToken}`);
      expect(staffRes.status).toBe(403);

      const studentRes = await request(app)
        .get('/api/v1/admin/settings/request-workflow')
        .set('Authorization', `Bearer ${studentToken}`);
      expect(studentRes.status).toBe(403);
    });

    it('3. unauthenticated requests are rejected with 401', async () => {
      const res = await request(app).get('/api/v1/admin/settings/request-workflow');
      expect(res.status).toBe(401);
    });
  });

  describe('PATCH /api/v1/admin/settings/request-workflow', () => {
    it('4. an administrator can update workflow settings with valid values', async () => {
      vi.spyOn(systemSettingsRepository, 'updateWorkflowSettings').mockResolvedValueOnce({
        reopenWindowDays: 14,
        maxReopenCount: 3,
      });

      const res = await request(app)
        .patch('/api/v1/admin/settings/request-workflow')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          reopenWindowDays: 14,
          maxReopenCount: 3,
        });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');
      expect(res.body.data.reopenWindowDays).toBe(14);
      expect(res.body.data.maxReopenCount).toBe(3);
    });

    it('5. rejects invalid reopenWindowDays (< 1) with 400', async () => {
      const res = await request(app)
        .patch('/api/v1/admin/settings/request-workflow')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          reopenWindowDays: 0,
        });

      expect(res.status).toBe(400);
    });

    it('6. rejects invalid maxReopenCount (> 5 or < 1) with 400', async () => {
      const tooHigh = await request(app)
        .patch('/api/v1/admin/settings/request-workflow')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          maxReopenCount: 6,
        });
      expect(tooHigh.status).toBe(400);

      const tooLow = await request(app)
        .patch('/api/v1/admin/settings/request-workflow')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          maxReopenCount: 0,
        });
      expect(tooLow.status).toBe(400);
    });

    it('7. non-admin users cannot update settings (403)', async () => {
      const res = await request(app)
        .patch('/api/v1/admin/settings/request-workflow')
        .set('Authorization', `Bearer ${staffToken}`)
        .send({
          reopenWindowDays: 10,
        });
      expect(res.status).toBe(403);
    });
  });
});
