import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../src/app';
import { signAccessToken } from '../../src/services/auth/token.service';
import { userRepository } from '../../src/repositories/user.repository';
import { departmentRepository } from '../../src/repositories/department.repository';
import { authorityRepository } from '../../src/repositories/authority.repository';
import { categoryRepository } from '../../src/repositories/category.repository';

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

describe('Category Management Endpoints', () => {
  const adminId = 'a0000000-0000-4000-8000-000000000099';
  const studentId = 'a0000000-0000-4000-8000-000000000001';
  const dept1Id = 'a0000000-0000-4000-8000-000000000010';
  const dept2Id = 'a0000000-0000-4000-8000-000000000011';
  const level1Id = 'a0000000-0000-4000-8000-000000000031';
  const catId = 'a0000000-0000-4000-8000-000000000041';

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

  describe('POST /api/v1/categories', () => {
    it('creates a category with valid department and initial authority level matching department', async () => {
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
        code: 'L1_REGISTRY',
        name: 'Tier 1 Officer',
        levelOrder: 1,
        description: null,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      vi.spyOn(categoryRepository, 'create').mockResolvedValueOnce({
        id: catId,
        name: 'Transcript Request',
        description: 'Official academic transcript issuance',
        departmentId: dept1Id,
        departmentName: 'Registry',
        initialAuthorityLevelId: level1Id,
        initialAuthorityLevelName: 'Tier 1 Officer',
        initialAuthorityLevelOrder: 1,
        defaultPriority: 'medium',
        defaultDueHours: 48,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const res = await request(app)
        .post('/api/v1/categories')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Transcript Request',
          description: 'Official academic transcript issuance',
          departmentId: dept1Id,
          initialAuthorityLevelId: level1Id,
          defaultPriority: 'medium',
          defaultDueHours: 48,
        });

      expect(res.status).toBe(201);
      expect(res.body.data.category.name).toBe('Transcript Request');
      expect(res.body.data.category.departmentId).toBe(dept1Id);
      expect(res.body.data.category.initialAuthorityLevelId).toBe(level1Id);
    });

    it('rejects cross-department initial authority level assignment', async () => {
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
        departmentId: dept2Id, // Cross-department mismatch!
        code: 'L1_FINANCE',
        name: 'Finance Level 1',
        levelOrder: 1,
        description: null,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const res = await request(app)
        .post('/api/v1/categories')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Transcript Request',
          departmentId: dept1Id,
          initialAuthorityLevelId: level1Id,
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('configured initial authority level must belong to the specified department');
    });
  });

  describe('GET /api/v1/categories', () => {
    it('restricts non-admin users to active categories only (Clarification 4)', async () => {
      vi.spyOn(categoryRepository, 'findAll').mockResolvedValueOnce({
        categories: [
          {
            id: catId,
            name: 'Transcript Request',
            description: null,
            departmentId: dept1Id,
            departmentName: 'Registry',
            initialAuthorityLevelId: level1Id,
            defaultPriority: 'medium',
            defaultDueHours: 24,
            isActive: true,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
        total: 1,
      });

      const res = await request(app)
        .get('/api/v1/categories')
        .set('Authorization', `Bearer ${studentToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.categories).toHaveLength(1);
      expect(res.body.data.categories[0].isActive).toBe(true);
    });
  });

  describe('PATCH /api/v1/categories/:id/status', () => {
    it('activates and deactivates a category for admin management', async () => {
      vi.spyOn(categoryRepository, 'findById').mockResolvedValueOnce({
        id: catId,
        name: 'Transcript Request',
        description: null,
        departmentId: dept1Id,
        departmentName: 'Registry',
        initialAuthorityLevelId: level1Id,
        defaultPriority: 'medium',
        defaultDueHours: null,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      vi.spyOn(categoryRepository, 'setStatus').mockResolvedValueOnce({
        id: catId,
        name: 'Transcript Request',
        description: null,
        departmentId: dept1Id,
        departmentName: 'Registry',
        initialAuthorityLevelId: level1Id,
        defaultPriority: 'medium',
        defaultDueHours: null,
        isActive: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const res = await request(app)
        .patch(`/api/v1/categories/${catId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ isActive: false });

      expect(res.status).toBe(200);
      expect(res.body.data.category.isActive).toBe(false);
    });
  });
});
