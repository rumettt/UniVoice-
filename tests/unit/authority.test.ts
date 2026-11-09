import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../src/app';
import { signAccessToken } from '../../src/services/auth/token.service';
import { userRepository } from '../../src/repositories/user.repository';
import { departmentRepository } from '../../src/repositories/department.repository';
import { authorityRepository } from '../../src/repositories/authority.repository';
import { staffRepository } from '../../src/repositories/staff.repository';

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

describe('Department Authority Management Endpoints', () => {
  const adminId = 'a0000000-0000-4000-8000-000000000099';
  const staffUserId = 'a0000000-0000-4000-8000-000000000020';
  const dept1Id = 'a0000000-0000-4000-8000-000000000010';
  const dept2Id = 'a0000000-0000-4000-8000-000000000011';
  const level1Id = 'a0000000-0000-4000-8000-000000000031';
  const level2Id = 'a0000000-0000-4000-8000-000000000032';

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
          primaryDepartmentId: dept1Id,
          isActive: true,
        };
      }
      return null;
    });
  });

  describe('POST /api/v1/departments/:departmentId/authority-levels', () => {
    it('creates an authority level within a department with monotonic levelOrder', async () => {
      vi.spyOn(departmentRepository, 'findById').mockResolvedValueOnce({
        id: dept1Id,
        name: 'Registry',
        code: 'REGISTRY',
        description: null,
        defaultMaxActiveRequests: 5,
        isActive: true,
        deactivatedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      vi.spyOn(authorityRepository, 'create').mockResolvedValueOnce({
        id: level1Id,
        departmentId: dept1Id,
        code: 'L1_OFFICER',
        name: 'Tier 1 Officer',
        levelOrder: 1,
        description: 'Handles frontline inquiries',
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const res = await request(app)
        .post(`/api/v1/departments/${dept1Id}/authority-levels`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          code: 'L1_OFFICER',
          name: 'Tier 1 Officer',
          levelOrder: 1,
          description: 'Handles frontline inquiries',
        });

      expect(res.status).toBe(201);
      expect(res.body.data.authorityLevel.levelOrder).toBe(1);
    });

    it('rejects duplicate level_order or code in the same department with 409', async () => {
      vi.spyOn(departmentRepository, 'findById').mockResolvedValueOnce({
        id: dept1Id,
        name: 'Registry',
        code: 'REGISTRY',
        description: null,
        defaultMaxActiveRequests: 5,
        isActive: true,
        deactivatedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      vi.spyOn(authorityRepository, 'create').mockRejectedValueOnce({ code: '23505' });

      const res = await request(app)
        .post(`/api/v1/departments/${dept1Id}/authority-levels`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          code: 'L1_OFFICER',
          name: 'Tier 1 Officer',
          levelOrder: 1,
        });

      expect(res.status).toBe(409);
      expect(res.body.message).toContain('already exists in this department');
    });
  });

  describe('PUT /api/v1/departments/:departmentId/authority-levels/reorder', () => {
    it('safely reorders authority levels inside a transaction using offset to avoid collisions (Clarification 2)', async () => {
      vi.spyOn(departmentRepository, 'findById').mockResolvedValueOnce({
        id: dept1Id,
        name: 'Registry',
        code: 'REGISTRY',
        description: null,
        defaultMaxActiveRequests: 5,
        isActive: true,
        deactivatedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      vi.spyOn(authorityRepository, 'findByDepartment').mockResolvedValueOnce([
        {
          id: level1Id,
          departmentId: dept1Id,
          code: 'L1',
          name: 'Tier 1',
          levelOrder: 1,
          description: null,
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: level2Id,
          departmentId: dept1Id,
          code: 'L2',
          name: 'Tier 2',
          levelOrder: 2,
          description: null,
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      vi.spyOn(authorityRepository, 'reorderLevels').mockResolvedValueOnce([
        {
          id: level2Id,
          departmentId: dept1Id,
          code: 'L2',
          name: 'Tier 2 now Tier 1',
          levelOrder: 1,
          description: null,
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: level1Id,
          departmentId: dept1Id,
          code: 'L1',
          name: 'Tier 1 now Tier 2',
          levelOrder: 2,
          description: null,
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      const res = await request(app)
        .put(`/api/v1/departments/${dept1Id}/authority-levels/reorder`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          levels: [
            { id: level2Id, levelOrder: 1 },
            { id: level1Id, levelOrder: 2 },
          ],
        });

      expect(res.status).toBe(200);
      expect(res.body.data.authorityLevels[0].id).toBe(level2Id);
      expect(res.body.data.authorityLevels[0].levelOrder).toBe(1);
    });
  });

  describe('POST /api/v1/departments/:departmentId/authority-levels/assignments', () => {
    it('assigns staff to an authority level within their department', async () => {
      vi.spyOn(departmentRepository, 'findById').mockResolvedValueOnce({
        id: dept1Id,
        name: 'Registry',
        code: 'REGISTRY',
        description: null,
        defaultMaxActiveRequests: 5,
        isActive: true,
        deactivatedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      vi.spyOn(authorityRepository, 'findById').mockResolvedValueOnce({
        id: level1Id,
        departmentId: dept1Id,
        code: 'L1_OFFICER',
        name: 'Tier 1 Officer',
        levelOrder: 1,
        description: null,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      vi.spyOn(staffRepository, 'findDepartmentsByStaff').mockResolvedValueOnce([
        {
          id: 'membership-uuid',
          staffUserId,
          departmentId: dept1Id,
          isPrimary: true,
          validFrom: new Date(),
          validTo: null,
          createdAt: new Date(),
        },
      ]);

      vi.spyOn(authorityRepository, 'assignStaff').mockResolvedValueOnce({
        id: 'auth-assignment-uuid-1',
        staffUserId,
        departmentAuthorityLevelId: level1Id,
        departmentId: dept1Id,
        validFrom: new Date(),
        validTo: null,
        createdAt: new Date(),
      });

      const res = await request(app)
        .post(`/api/v1/departments/${dept1Id}/authority-levels/assignments`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          staffUserId,
          departmentAuthorityLevelId: level1Id,
        });

      expect(res.status).toBe(201);
      expect(res.body.data.assignment.departmentAuthorityLevelId).toBe(level1Id);
    });

    it('rejects cross-department authority assignment (level belongs to another department)', async () => {
      vi.spyOn(departmentRepository, 'findById').mockResolvedValueOnce({
        id: dept1Id,
        name: 'Registry',
        code: 'REGISTRY',
        description: null,
        defaultMaxActiveRequests: 5,
        isActive: true,
        deactivatedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      vi.spyOn(authorityRepository, 'findById').mockResolvedValueOnce({
        id: level1Id,
        departmentId: dept2Id, // Cross-department mismatch
        code: 'L1_LIBRARY',
        name: 'Library Officer',
        levelOrder: 1,
        description: null,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const res = await request(app)
        .post(`/api/v1/departments/${dept1Id}/authority-levels/assignments`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          staffUserId,
          departmentAuthorityLevelId: level1Id,
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('does not belong to the specified department');
    });

    it('rejects assigning staff who does not have an active appointment in the department', async () => {
      vi.spyOn(departmentRepository, 'findById').mockResolvedValueOnce({
        id: dept1Id,
        name: 'Registry',
        code: 'REGISTRY',
        description: null,
        defaultMaxActiveRequests: 5,
        isActive: true,
        deactivatedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      vi.spyOn(authorityRepository, 'findById').mockResolvedValueOnce({
        id: level1Id,
        departmentId: dept1Id,
        code: 'L1_OFFICER',
        name: 'Officer',
        levelOrder: 1,
        description: null,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      vi.spyOn(staffRepository, 'findDepartmentsByStaff').mockResolvedValueOnce([]);

      const res = await request(app)
        .post(`/api/v1/departments/${dept1Id}/authority-levels/assignments`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          staffUserId,
          departmentAuthorityLevelId: level1Id,
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('does not have an active appointment in this department');
    });
  });
});
