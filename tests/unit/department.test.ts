import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../src/app';
import { signAccessToken } from '../../src/services/auth/token.service';
import { userRepository } from '../../src/repositories/user.repository';

const mockQuery = vi.fn();

vi.mock('../../src/config/db', () => ({
  pool: {
    query: (...args: unknown[]) => mockQuery(...args),
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

describe('Department Management Endpoints', () => {
  const adminId = '00000000-0000-0000-0000-000000000099';
  const studentId = '00000000-0000-0000-0000-000000000001';
  const deptId = '00000000-0000-0000-0000-000000000010';

  let adminToken: string;
  let studentToken: string;

  beforeEach(() => {
    vi.clearAllMocks();

    adminToken = signAccessToken({
      sub: adminId,
      email: 'admin@univoice.edu',
      role: 'admin',
    });

    studentToken = signAccessToken({
      sub: studentId,
      email: 'student@univoice.edu',
      role: 'student',
    });

    vi.spyOn(userRepository, 'findById').mockImplementation(async (id: string) => {
      if (id === adminId) {
        return {
          id: adminId,
          firstName: 'System',
          lastName: 'Admin',
          fullName: 'System Admin',
          email: 'admin@univoice.edu',
          role: 'admin',
          primaryDepartmentId: null,
          isActive: true,
        };
      }
      if (id === studentId) {
        return {
          id: studentId,
          firstName: 'Test',
          lastName: 'Student',
          fullName: 'Test Student',
          email: 'student@univoice.edu',
          role: 'student',
          primaryDepartmentId: null,
          isActive: true,
        };
      }
      return null;
    });
  });

  describe('POST /api/v1/departments', () => {
    it('creates a department with valid code and positive max requests', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: deptId,
            name: 'Financial Aid',
            code: 'FIN_AID',
            description: 'Financial aid and scholarships',
            defaultMaxActiveRequests: 7,
            isActive: true,
            deactivatedAt: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
      });

      const res = await request(app)
        .post('/api/v1/departments')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Financial Aid',
          code: 'FIN_AID',
          description: 'Financial aid and scholarships',
          defaultMaxActiveRequests: 7,
        });

      expect(res.status).toBe(201);
      expect(res.body.data.department.code).toBe('FIN_AID');
      expect(res.body.data.department.defaultMaxActiveRequests).toBe(7);
    });

    it('rejects invalid code format (lowercase or invalid characters)', async () => {
      const res = await request(app)
        .post('/api/v1/departments')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Financial Aid',
          code: 'fin-aid!',
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Validation failed');
    });

    it('rejects duplicate department code or name with 409', async () => {
      mockQuery.mockRejectedValueOnce({ code: '23505' });

      const res = await request(app)
        .post('/api/v1/departments')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Financial Aid',
          code: 'FIN_AID',
        });

      expect(res.status).toBe(409);
      expect(res.body.message).toContain('already exists');
    });

    it('blocks non-admin users with 403', async () => {
      const res = await request(app)
        .post('/api/v1/departments')
        .set('Authorization', `Bearer ${studentToken}`)
        .send({
          name: 'Financial Aid',
          code: 'FIN_AID',
        });

      expect(res.status).toBe(403);
    });
  });

  describe('GET /api/v1/departments/:id', () => {
    it('retrieves department with derived metrics (Clarification 5)', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: deptId,
            name: 'Financial Aid',
            code: 'FIN_AID',
            description: 'Financial aid',
            defaultMaxActiveRequests: 5,
            isActive: true,
            deactivatedAt: null,
            createdAt: new Date(),
            updatedAt: new Date(),
            activeAuthorityLevelsCount: 3,
            activeStaffCount: 8,
            activeCategoriesCount: 4,
          },
        ],
      });

      const res = await request(app)
        .get(`/api/v1/departments/${deptId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.department.id).toBe(deptId);
      expect(res.body.data.department.metrics).toEqual({
        activeAuthorityLevelsCount: 3,
        activeStaffCount: 8,
        activeCategoriesCount: 4,
      });
    });
  });

  describe('PATCH /api/v1/departments/:id/status', () => {
    it('activates and deactivates department maintaining consistency', async () => {
      // 1. findById check
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: deptId, isActive: true }],
      });

      // 2. setStatus update
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: deptId,
            name: 'Financial Aid',
            code: 'FIN_AID',
            description: null,
            defaultMaxActiveRequests: 5,
            isActive: false,
            deactivatedAt: new Date(),
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
      });

      const res = await request(app)
        .patch(`/api/v1/departments/${deptId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ isActive: false });

      expect(res.status).toBe(200);
      expect(res.body.data.department.isActive).toBe(false);
      expect(res.body.data.department.deactivatedAt).not.toBeNull();
    });
  });
});
