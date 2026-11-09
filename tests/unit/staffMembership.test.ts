import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../src/app';
import { signAccessToken } from '../../src/services/auth/token.service';
import { userRepository } from '../../src/repositories/user.repository';
import { departmentRepository } from '../../src/repositories/department.repository';
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

describe('Staff Department Membership Endpoints', () => {
  const adminId = 'a0000000-0000-4000-8000-000000000099';
  const staffUserId = 'a0000000-0000-4000-8000-000000000020';
  const dept1Id = 'a0000000-0000-4000-8000-000000000010';
  const dept2Id = 'a0000000-0000-4000-8000-000000000011';

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
      return null;
    });
  });

  describe('POST /api/v1/departments/:departmentId/staff', () => {
    it('assigns staff to a department preserving effective-dated history (Clarification 3)', async () => {
      vi.spyOn(userRepository, 'findDetailById').mockResolvedValueOnce({
        id: staffUserId,
        firstName: 'Staff',
        lastName: 'User',
        fullName: 'Staff User',
        email: 'staff@univoice.edu',
        phone: null,
        role: 'staff',
        primaryDepartmentId: null,
        profileImageUrl: null,
        isActive: true,
        deactivatedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

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

      vi.spyOn(staffRepository, 'assignDepartment').mockResolvedValueOnce({
        id: 'membership-uuid-1',
        staffUserId,
        departmentId: dept1Id,
        isPrimary: true,
        validFrom: new Date(),
        validTo: null,
        createdAt: new Date(),
      });

      const res = await request(app)
        .post(`/api/v1/departments/${dept1Id}/staff`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          staffUserId,
          isPrimary: true,
        });

      expect(res.status).toBe(201);
      expect(res.body.data.membership.staffUserId).toBe(staffUserId);
      expect(res.body.data.membership.departmentId).toBe(dept1Id);
    });

    it('supports simultaneous membership in multiple departments', async () => {
      vi.spyOn(userRepository, 'findDetailById').mockResolvedValueOnce({
        id: staffUserId,
        firstName: 'Staff',
        lastName: 'User',
        fullName: 'Staff User',
        email: 'staff@univoice.edu',
        phone: null,
        role: 'staff',
        primaryDepartmentId: dept1Id,
        profileImageUrl: null,
        isActive: true,
        deactivatedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      vi.spyOn(departmentRepository, 'findById').mockResolvedValueOnce({
        id: dept2Id,
        name: 'Library Services',
        code: 'LIBRARY',
        description: null,
        defaultMaxActiveRequests: 5,
        isActive: true,
        deactivatedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      vi.spyOn(staffRepository, 'assignDepartment').mockResolvedValueOnce({
        id: 'membership-uuid-2',
        staffUserId,
        departmentId: dept2Id,
        isPrimary: false,
        validFrom: new Date(),
        validTo: null,
        createdAt: new Date(),
      });

      const res = await request(app)
        .post(`/api/v1/departments/${dept2Id}/staff`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          staffUserId,
          isPrimary: false,
        });

      expect(res.status).toBe(201);
      expect(res.body.data.membership.departmentId).toBe(dept2Id);
    });

    it('rejects assigning student accounts to a department', async () => {
      vi.spyOn(userRepository, 'findDetailById').mockResolvedValueOnce({
        id: staffUserId,
        firstName: 'Student',
        lastName: 'User',
        fullName: 'Student User',
        email: 'student@univoice.edu',
        phone: null,
        role: 'student',
        primaryDepartmentId: null,
        profileImageUrl: null,
        isActive: true,
        deactivatedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const res = await request(app)
        .post(`/api/v1/departments/${dept1Id}/staff`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          staffUserId,
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Only staff or admin accounts');
    });
  });

  describe('DELETE /api/v1/departments/:departmentId/staff/:staffUserId', () => {
    it('ends an active staff department appointment by setting valid_to instead of deleting (Clarification 3)', async () => {
      vi.spyOn(staffRepository, 'endDepartmentMembership').mockResolvedValueOnce({
        id: 'membership-uuid-1',
        staffUserId,
        departmentId: dept1Id,
        isPrimary: false,
        validFrom: new Date('2026-01-01'),
        validTo: new Date(),
        createdAt: new Date(),
      });

      const res = await request(app)
        .delete(`/api/v1/departments/${dept1Id}/staff/${staffUserId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.membership.validTo).not.toBeNull();
    });
  });
});
