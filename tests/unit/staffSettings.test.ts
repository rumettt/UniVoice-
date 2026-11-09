import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../src/app';
import { signAccessToken } from '../../src/services/auth/token.service';
import { userRepository } from '../../src/repositories/user.repository';
import { departmentRepository } from '../../src/repositories/department.repository';
import { staffRepository } from '../../src/repositories/staff.repository';

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

describe('Staff Work Settings Endpoints', () => {
  const adminId = 'a0000000-0000-4000-8000-000000000099';
  const staffUserId = 'a0000000-0000-4000-8000-000000000020';
  const deptId = 'a0000000-0000-4000-8000-000000000010';

  let adminToken: string;

  beforeEach(() => {
    vi.clearAllMocks();

    adminToken = signAccessToken({
      sub: adminId,
      email: 'admin@univoice.edu',
      role: 'admin',
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
      if (id === staffUserId) {
        return {
          id: staffUserId,
          firstName: 'Staff',
          lastName: 'Member',
          fullName: 'Staff Member',
          email: 'staff@univoice.edu',
          role: 'staff',
          primaryDepartmentId: deptId,
          isActive: true,
        };
      }
      return null;
    });
  });

  describe('GET /api/v1/departments/:departmentId/staff/:staffUserId/work-settings', () => {
    it('returns department default capacity when override is NULL', async () => {
      vi.spyOn(departmentRepository, 'findById').mockResolvedValueOnce({
        id: deptId,
        name: 'Registry',
        code: 'REGISTRY',
        description: null,
        defaultMaxActiveRequests: 5,
        isActive: true,
        deactivatedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      vi.spyOn(staffRepository, 'getWorkSettings').mockResolvedValueOnce({
        id: 'ws-uuid-1',
        staffUserId,
        departmentId: deptId,
        isAvailable: true,
        maxActiveRequestsOverride: null,
        departmentDefaultMaxActiveRequests: 5,
        effectiveMaxActiveRequests: 5,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const res = await request(app)
        .get(`/api/v1/departments/${deptId}/staff/${staffUserId}/work-settings`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.workSettings.maxActiveRequestsOverride).toBeNull();
      expect(res.body.data.workSettings.departmentDefaultMaxActiveRequests).toBe(5);
      expect(res.body.data.workSettings.effectiveMaxActiveRequests).toBe(5);
    });

    it('returns custom override when maxActiveRequestsOverride is configured', async () => {
      vi.spyOn(departmentRepository, 'findById').mockResolvedValueOnce({
        id: deptId,
        name: 'Registry',
        code: 'REGISTRY',
        description: null,
        defaultMaxActiveRequests: 5,
        isActive: true,
        deactivatedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      vi.spyOn(staffRepository, 'getWorkSettings').mockResolvedValueOnce({
        id: 'ws-uuid-1',
        staffUserId,
        departmentId: deptId,
        isAvailable: true,
        maxActiveRequestsOverride: 10,
        departmentDefaultMaxActiveRequests: 5,
        effectiveMaxActiveRequests: 10,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const res = await request(app)
        .get(`/api/v1/departments/${deptId}/staff/${staffUserId}/work-settings`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.workSettings.maxActiveRequestsOverride).toBe(10);
      expect(res.body.data.workSettings.effectiveMaxActiveRequests).toBe(10);
    });
  });

  describe('PATCH /api/v1/departments/:departmentId/staff/:staffUserId/work-settings', () => {
    it('updates staff availability independently of capacity', async () => {
      vi.spyOn(departmentRepository, 'findById').mockResolvedValueOnce({
        id: deptId,
        name: 'Registry',
        code: 'REGISTRY',
        description: null,
        defaultMaxActiveRequests: 5,
        isActive: true,
        deactivatedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      vi.spyOn(staffRepository, 'upsertWorkSettings').mockResolvedValueOnce({
        id: 'ws-uuid-1',
        staffUserId,
        departmentId: deptId,
        isAvailable: false,
        maxActiveRequestsOverride: 10,
        departmentDefaultMaxActiveRequests: 5,
        effectiveMaxActiveRequests: 10,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const res = await request(app)
        .patch(`/api/v1/departments/${deptId}/staff/${staffUserId}/work-settings`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ isAvailable: false });

      expect(res.status).toBe(200);
      expect(res.body.data.workSettings.isAvailable).toBe(false);
      expect(res.body.data.workSettings.maxActiveRequestsOverride).toBe(10);
    });
  });
});
