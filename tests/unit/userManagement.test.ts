import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../src/app';
import { signAccessToken } from '../../src/services/auth/token.service';
import { userRepository } from '../../src/repositories/user.repository';
import { departmentRepository } from '../../src/repositories/department.repository';

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

describe('User Management Endpoints', () => {
  const adminId = 'a0000000-0000-4000-8000-000000000099';
  const studentId = 'a0000000-0000-4000-8000-000000000001';
  const staffUserId = 'a0000000-0000-4000-8000-000000000002';
  const deptId = 'a0000000-0000-4000-8000-000000000010';

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
      if (id === staffUserId) {
        return {
          id: staffUserId,
          firstName: 'Test',
          lastName: 'Staff',
          fullName: 'Test Staff',
          email: 'teststaff@univoice.edu',
          role: 'staff',
          primaryDepartmentId: deptId,
          isActive: true,
        };
      }
      return null;
    });
  });

  describe('POST /api/v1/users', () => {
    it('creates a student account with student_profiles in a transaction', async () => {
      vi.spyOn(userRepository, 'findByEmail').mockResolvedValueOnce(null);

      mockClientQuery.mockImplementation((sql: string) => {
        if (sql === 'BEGIN' || sql === 'COMMIT') return Promise.resolve();
        if (sql.includes('INSERT INTO users')) {
          return Promise.resolve({
            rows: [
              {
                id: studentId,
                firstName: 'Jane',
                lastName: 'Doe',
                fullName: 'Jane Doe',
                email: 'jane.doe@univoice.edu',
                phone: '+1 555-0199',
                role: 'student',
                primaryDepartmentId: null,
                profileImageUrl: null,
                isActive: true,
                deactivatedAt: null,
                createdAt: new Date(),
                updatedAt: new Date(),
              },
            ],
          });
        }
        if (sql.includes('INSERT INTO student_profiles')) {
          return Promise.resolve({
            rows: [
              {
                studentNumber: 'STU-9901',
                programName: 'Computer Science',
              },
            ],
          });
        }
        return Promise.resolve({ rows: [] });
      });

      const res = await request(app)
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          role: 'student',
          firstName: 'Jane',
          lastName: 'Doe',
          email: 'jane.doe@univoice.edu',
          password: 'Password123!',
          phone: '+1 555-0199',
          studentNumber: 'STU-9901',
          programName: 'Computer Science',
        });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('success');
      expect(res.body.data.user.role).toBe('student');
      expect(res.body.data.user.studentProfile.studentNumber).toBe('STU-9901');
      expect(res.body.data.user.passwordHash).toBeUndefined();
    });

    it('creates a staff account with profile and initial department membership in a transaction (Clarification 1)', async () => {
      vi.spyOn(userRepository, 'findByEmail').mockResolvedValueOnce(null);
      vi.spyOn(departmentRepository, 'findById').mockResolvedValueOnce({
        id: deptId,
        name: 'Academic Registry',
        code: 'REGISTRY',
        description: null,
        defaultMaxActiveRequests: 5,
        isActive: true,
        deactivatedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      mockClientQuery.mockImplementation((sql: string) => {
        if (sql === 'BEGIN' || sql === 'COMMIT') return Promise.resolve();
        if (sql.includes('INSERT INTO users')) {
          return Promise.resolve({
            rows: [
              {
                id: staffUserId,
                firstName: 'Mark',
                lastName: 'Staff',
                fullName: 'Mark Staff',
                email: 'mark@univoice.edu',
                phone: null,
                role: 'staff',
                primaryDepartmentId: deptId,
                profileImageUrl: null,
                isActive: true,
                deactivatedAt: null,
                createdAt: new Date(),
                updatedAt: new Date(),
              },
            ],
          });
        }
        if (sql.includes('INSERT INTO staff_profiles')) {
          return Promise.resolve({
            rows: [
              {
                employeeNumber: 'EMP-1001',
                currentPositionId: null,
              },
            ],
          });
        }
        if (sql.includes('INSERT INTO staff_department_memberships')) {
          return Promise.resolve({ rows: [] });
        }
        if (sql.includes('INSERT INTO staff_department_work_settings')) {
          return Promise.resolve({ rows: [] });
        }
        return Promise.resolve({ rows: [] });
      });

      const res = await request(app)
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          role: 'staff',
          firstName: 'Mark',
          lastName: 'Staff',
          email: 'mark@univoice.edu',
          password: 'Password123!',
          employeeNumber: 'EMP-1001',
          primaryDepartmentId: deptId,
        });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('success');
      expect(res.body.data.user.role).toBe('staff');
      expect(res.body.data.user.staffProfile.employeeNumber).toBe('EMP-1001');
      expect(res.body.data.user.primaryDepartmentId).toBe(deptId);
    });

    it('rejects staff account creation if department does not exist', async () => {
      vi.spyOn(userRepository, 'findByEmail').mockResolvedValueOnce(null);
      vi.spyOn(departmentRepository, 'findById').mockResolvedValueOnce(null);

      const res = await request(app)
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          role: 'staff',
          firstName: 'Mark',
          lastName: 'Staff',
          email: 'mark@univoice.edu',
          password: 'Password123!',
          employeeNumber: 'EMP-1001',
          primaryDepartmentId: deptId,
        });

      expect(res.status).toBe(404);
      expect(res.body.message).toContain('primary department does not exist');
    });

    it('rejects user creation with duplicate email', async () => {
      vi.spyOn(userRepository, 'findByEmail').mockResolvedValueOnce({
        id: 'existing-id',
        firstName: 'Existing',
        lastName: 'User',
        fullName: 'Existing User',
        email: 'existing@univoice.edu',
        passwordHash: 'hash',
        role: 'student',
        primaryDepartmentId: null,
        isActive: true,
      });

      const res = await request(app)
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          role: 'student',
          firstName: 'Jane',
          lastName: 'Doe',
          email: 'existing@univoice.edu',
          password: 'Password123!',
          studentNumber: 'STU-9901',
        });

      expect(res.status).toBe(409);
      expect(res.body.message).toContain('already exists');
    });

    it('rejects non-admin users from creating accounts with 403', async () => {
      const res = await request(app)
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${studentToken}`)
        .send({
          role: 'student',
          firstName: 'Jane',
          lastName: 'Doe',
          email: 'jane@univoice.edu',
          password: 'Password123!',
          studentNumber: 'STU-9901',
        });

      expect(res.status).toBe(403);
    });
  });

  describe('PATCH /api/v1/users/:id/status', () => {
    it('activates and deactivates a user account, revoking refresh tokens on deactivation', async () => {
      vi.spyOn(userRepository, 'setStatus').mockResolvedValueOnce({
        id: staffUserId,
        firstName: 'Test',
        lastName: 'Staff',
        fullName: 'Test Staff',
        email: 'teststaff@univoice.edu',
        phone: null,
        role: 'staff',
        primaryDepartmentId: deptId,
        profileImageUrl: null,
        isActive: false,
        deactivatedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const res = await request(app)
        .patch(`/api/v1/users/${staffUserId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ isActive: false });

      expect(res.status).toBe(200);
      expect(res.body.data.user.isActive).toBe(false);
      expect(res.body.data.user.deactivatedAt).not.toBeNull();
    });

    it('prevents an administrator from deactivating their own account', async () => {
      const res = await request(app)
        .patch(`/api/v1/users/${adminId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ isActive: false });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('cannot deactivate their own account');
    });
  });
});
