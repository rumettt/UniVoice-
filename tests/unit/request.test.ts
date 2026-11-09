import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../src/app';
import { signAccessToken } from '../../src/services/auth/token.service';
import { userRepository } from '../../src/repositories/user.repository';
import {
  requestRepository,
  RequestRecord,
  LockedCategoryRouting,
} from '../../src/repositories/request.repository';

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

describe('Request Submission & Student Workflow Endpoints (Phase 4)', () => {
  const student1Id = 'a0000000-0000-4000-8000-000000000001';
  const student2Id = 'a0000000-0000-4000-8000-000000000002';
  const staffUserId = 'a0000000-0000-4000-8000-000000000003';
  const adminId = 'a0000000-0000-4000-8000-000000000099';

  const deptId = 'a0000000-0000-4000-8000-000000000010';
  const otherDeptId = 'a0000000-0000-4000-8000-000000000011';
  const level1Id = 'a0000000-0000-4000-8000-000000000031';
  const catId = 'a0000000-0000-4000-8000-000000000041';
  const reqId1 = 'a0000000-0000-4000-8000-000000000051';
  const reqId2 = 'a0000000-0000-4000-8000-000000000052';

  let student1Token: string;
  let student2Token: string;
  let staffToken: string;
  let adminToken: string;

  beforeEach(() => {
    vi.clearAllMocks();

    student1Token = signAccessToken({
      sub: student1Id,
      email: 'student1@univoice.edu',
      role: 'student',
    });

    student2Token = signAccessToken({
      sub: student2Id,
      email: 'student2@univoice.edu',
      role: 'student',
    });

    staffToken = signAccessToken({
      sub: staffUserId,
      email: 'staff@univoice.edu',
      role: 'staff',
    });

    adminToken = signAccessToken({
      sub: adminId,
      email: 'admin@univoice.edu',
      role: 'admin',
    });

    vi.spyOn(userRepository, 'findById').mockImplementation(async (id: string) => {
      if (id === student1Id) {
        return {
          id: student1Id,
          firstName: 'Alice',
          lastName: 'Student',
          fullName: 'Alice Student',
          email: 'student1@univoice.edu',
          role: 'student',
          primaryDepartmentId: null,
          isActive: true,
        };
      }
      if (id === student2Id) {
        return {
          id: student2Id,
          firstName: 'Bob',
          lastName: 'Student',
          fullName: 'Bob Student',
          email: 'student2@univoice.edu',
          role: 'student',
          primaryDepartmentId: null,
          isActive: true,
        };
      }
      if (id === staffUserId) {
        return {
          id: staffUserId,
          firstName: 'Staff',
          lastName: 'User',
          fullName: 'Staff User',
          email: 'staff@univoice.edu',
          role: 'staff',
          primaryDepartmentId: deptId,
          isActive: true,
        };
      }
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

  describe('POST /api/v1/requests (Request Submission & Routing)', () => {
    const validRouting: LockedCategoryRouting = {
      categoryId: catId,
      categoryName: 'Official Transcript',
      categoryIsActive: true,
      defaultPriority: 'medium',
      defaultDueHours: 48,
      departmentId: deptId,
      departmentName: 'Academic Registry',
      departmentCode: 'REGISTRY',
      departmentIsActive: true,
      authorityLevelId: level1Id,
      authorityLevelName: 'Level 1 Intake',
      authorityLevelOrder: 1,
      authorityLevelIsActive: true,
      authorityDepartmentId: deptId,
    };

    it('1. an authenticated student successfully submits a valid request', async () => {
      vi.spyOn(requestRepository, 'lockAndGetCategoryRouting').mockResolvedValueOnce(validRouting);
      vi.spyOn(requestRepository, 'generatePublicRef').mockResolvedValueOnce('REQ-2026-00001');

      const createdRecord: RequestRecord = {
        id: reqId1,
        publicRef: 'REQ-2026-00001',
        title: 'Need official transcript for graduate application',
        description: 'Please issue transcript stamped by the registrar.',
        studentId: student1Id,
        categoryId: catId,
        responsibleDepartmentId: deptId,
        currentAuthorityLevelId: level1Id,
        currentAssignmentId: null,
        currentEscalationId: null,
        priority: 'medium',
        status: 'pending',
        dueAt: new Date(Date.now() + 48 * 3600 * 1000),
        resolutionNotes: null,
        resolvedAt: null,
        closedAt: null,
        rejectedAt: null,
        reopenCount: 0,
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        student: { id: student1Id, fullName: 'Alice Student', email: 'student1@univoice.edu' },
        category: { id: catId, name: 'Official Transcript' },
        department: { id: deptId, name: 'Academic Registry', code: 'REGISTRY' },
        currentAuthorityLevel: { id: level1Id, name: 'Level 1 Intake', levelOrder: 1 },
      };

      vi.spyOn(requestRepository, 'insertRequest').mockResolvedValueOnce(createdRecord);

      const res = await request(app)
        .post('/api/v1/requests')
        .set('Authorization', `Bearer ${student1Token}`)
        .send({
          categoryId: catId,
          title: 'Need official transcript for graduate application',
          description: 'Please issue transcript stamped by the registrar.',
        });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('success');
      expect(res.body.data.request).toBeDefined();
      expect(res.body.data.request.publicRef).toBe('REQ-2026-00001');
      expect(res.body.data.request.status).toBe('pending');
      expect(res.body.data.request.currentAssignmentId).toBeNull();
    });

    it('2. the correct student ID is taken from authentication (req.user.id)', async () => {
      const lockSpy = vi.spyOn(requestRepository, 'lockAndGetCategoryRouting').mockResolvedValueOnce(validRouting);
      vi.spyOn(requestRepository, 'generatePublicRef').mockResolvedValueOnce('REQ-2026-00001');
      const insertSpy = vi.spyOn(requestRepository, 'insertRequest').mockResolvedValueOnce({
        id: reqId1,
        publicRef: 'REQ-2026-00001',
        title: 'Transcript Request',
        description: 'Details',
        studentId: student1Id,
        categoryId: catId,
        responsibleDepartmentId: deptId,
        currentAuthorityLevelId: level1Id,
        currentAssignmentId: null,
        currentEscalationId: null,
        priority: 'medium',
        status: 'pending',
        dueAt: null,
        resolutionNotes: null,
        resolvedAt: null,
        closedAt: null,
        rejectedAt: null,
        reopenCount: 0,
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const res = await request(app)
        .post('/api/v1/requests')
        .set('Authorization', `Bearer ${student1Token}`)
        .send({
          categoryId: catId,
          title: 'Transcript Request',
          description: 'Details',
        });

      expect(res.status).toBe(201);
      expect(insertSpy).toHaveBeenCalledWith(
        expect.objectContaining({ studentId: student1Id }),
        expect.anything(),
      );
    });

    it('3 & 4. the correct department and initial authority level are derived from category in PostgreSQL', async () => {
      vi.spyOn(requestRepository, 'lockAndGetCategoryRouting').mockResolvedValueOnce(validRouting);
      vi.spyOn(requestRepository, 'generatePublicRef').mockResolvedValueOnce('REQ-2026-00001');
      const insertSpy = vi.spyOn(requestRepository, 'insertRequest').mockResolvedValueOnce({
        id: reqId1,
        publicRef: 'REQ-2026-00001',
        title: 'Fee waiver inquiry',
        description: 'Urgent inquiry',
        studentId: student1Id,
        categoryId: catId,
        responsibleDepartmentId: deptId,
        currentAuthorityLevelId: level1Id,
        currentAssignmentId: null,
        currentEscalationId: null,
        priority: 'medium',
        status: 'pending',
        dueAt: null,
        resolutionNotes: null,
        resolvedAt: null,
        closedAt: null,
        rejectedAt: null,
        reopenCount: 0,
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const res = await request(app)
        .post('/api/v1/requests')
        .set('Authorization', `Bearer ${student1Token}`)
        .send({
          categoryId: catId,
          title: 'Fee waiver inquiry',
          description: 'Urgent inquiry',
        });

      expect(res.status).toBe(201);
      expect(insertSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          responsibleDepartmentId: deptId,
          currentAuthorityLevelId: level1Id,
        }),
        expect.anything(),
      );
    });

    it('5. the request enters the correct unassigned queue (pending status and NULL assignment)', async () => {
      vi.spyOn(requestRepository, 'lockAndGetCategoryRouting').mockResolvedValueOnce(validRouting);
      vi.spyOn(requestRepository, 'generatePublicRef').mockResolvedValueOnce('REQ-2026-00001');
      const insertSpy = vi.spyOn(requestRepository, 'insertRequest').mockResolvedValueOnce({
        id: reqId1,
        publicRef: 'REQ-2026-00001',
        title: 'Title',
        description: 'Desc',
        studentId: student1Id,
        categoryId: catId,
        responsibleDepartmentId: deptId,
        currentAuthorityLevelId: level1Id,
        currentAssignmentId: null,
        currentEscalationId: null,
        priority: 'medium',
        status: 'pending',
        dueAt: null,
        resolutionNotes: null,
        resolvedAt: null,
        closedAt: null,
        rejectedAt: null,
        reopenCount: 0,
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const res = await request(app)
        .post('/api/v1/requests')
        .set('Authorization', `Bearer ${student1Token}`)
        .send({
          categoryId: catId,
          title: 'Title',
          description: 'Desc',
        });

      expect(res.status).toBe(201);
      expect(res.body.data.request.status).toBe('pending');
      expect(res.body.data.request.currentAssignmentId).toBeNull();
    });

    it('6. the initial history entry is handled atomically in the transaction', async () => {
      vi.spyOn(requestRepository, 'lockAndGetCategoryRouting').mockResolvedValueOnce(validRouting);
      vi.spyOn(requestRepository, 'generatePublicRef').mockResolvedValueOnce('REQ-2026-00001');
      vi.spyOn(requestRepository, 'insertRequest').mockResolvedValueOnce({
        id: reqId1,
        publicRef: 'REQ-2026-00001',
        title: 'Title',
        description: 'Desc',
        studentId: student1Id,
        categoryId: catId,
        responsibleDepartmentId: deptId,
        currentAuthorityLevelId: level1Id,
        currentAssignmentId: null,
        currentEscalationId: null,
        priority: 'medium',
        status: 'pending',
        dueAt: null,
        resolutionNotes: null,
        resolvedAt: null,
        closedAt: null,
        rejectedAt: null,
        reopenCount: 0,
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const res = await request(app)
        .post('/api/v1/requests')
        .set('Authorization', `Bearer ${student1Token}`)
        .send({
          categoryId: catId,
          title: 'Title',
          description: 'Desc',
        });

      expect(res.status).toBe(201);
      // Client transaction commits successfully
      expect(mockClientQuery).toHaveBeenCalledWith('BEGIN');
      expect(mockClientQuery).toHaveBeenCalledWith('COMMIT');
    });

    it('7. unauthenticated users cannot submit requests (401)', async () => {
      const res = await request(app)
        .post('/api/v1/requests')
        .send({
          categoryId: catId,
          title: 'Unauthenticated Request',
          description: 'Desc',
        });

      expect(res.status).toBe(401);
      expect(res.body.message).toContain('Authentication required');
    });

    it('8. staff and administrators cannot use the student submission endpoint (403)', async () => {
      const staffRes = await request(app)
        .post('/api/v1/requests')
        .set('Authorization', `Bearer ${staffToken}`)
        .send({
          categoryId: catId,
          title: 'Staff Request',
          description: 'Desc',
        });
      expect(staffRes.status).toBe(403);
      expect(staffRes.body.message).toContain('insufficient role permissions');

      const adminRes = await request(app)
        .post('/api/v1/requests')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          categoryId: catId,
          title: 'Admin Request',
          description: 'Desc',
        });
      expect(adminRes.status).toBe(403);
      expect(adminRes.body.message).toContain('insufficient role permissions');
    });

    it('9. inactive categories cannot receive new requests (400)', async () => {
      vi.spyOn(requestRepository, 'lockAndGetCategoryRouting').mockResolvedValueOnce({
        ...validRouting,
        categoryIsActive: false,
      });

      const res = await request(app)
        .post('/api/v1/requests')
        .set('Authorization', `Bearer ${student1Token}`)
        .send({
          categoryId: catId,
          title: 'Request on inactive category',
          description: 'Desc',
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('inactive category');
    });

    it('10. nonexistent categories are rejected (404)', async () => {
      vi.spyOn(requestRepository, 'lockAndGetCategoryRouting').mockResolvedValueOnce(null);

      const res = await request(app)
        .post('/api/v1/requests')
        .set('Authorization', `Bearer ${student1Token}`)
        .send({
          categoryId: 'b0000000-0000-4000-8000-000000000099',
          title: 'Request on nonexistent category',
          description: 'Desc',
        });

      expect(res.status).toBe(404);
      expect(res.body.message).toContain('Category not found');
    });

    it('11. categories with invalid or missing routing configuration are rejected safely (400)', async () => {
      // Inactive department
      vi.spyOn(requestRepository, 'lockAndGetCategoryRouting').mockResolvedValueOnce({
        ...validRouting,
        departmentIsActive: false,
      });

      const res1 = await request(app)
        .post('/api/v1/requests')
        .set('Authorization', `Bearer ${student1Token}`)
        .send({
          categoryId: catId,
          title: 'Title',
          description: 'Desc',
        });
      expect(res1.status).toBe(400);
      expect(res1.body.message).toContain('department responsible for this category is currently inactive');

      // Cross-department authority level mismatch
      vi.spyOn(requestRepository, 'lockAndGetCategoryRouting').mockResolvedValueOnce({
        ...validRouting,
        authorityDepartmentId: otherDeptId,
      });

      const res2 = await request(app)
        .post('/api/v1/requests')
        .set('Authorization', `Bearer ${student1Token}`)
        .send({
          categoryId: catId,
          title: 'Title',
          description: 'Desc',
        });
      expect(res2.status).toBe(400);
      expect(res2.body.message).toContain('initial authority level does not belong to responsible department');
    });

    it('12. a client cannot override department or authority-level routing (mass assignment prevented with 400)', async () => {
      const res = await request(app)
        .post('/api/v1/requests')
        .set('Authorization', `Bearer ${student1Token}`)
        .send({
          categoryId: catId,
          title: 'Trying to inject department',
          description: 'Desc',
          departmentId: deptId,
          currentAuthorityLevelId: level1Id,
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Validation failed');
    });

    it('13. a client cannot set its own request status or staff assignment (mass assignment prevented with 400)', async () => {
      const res = await request(app)
        .post('/api/v1/requests')
        .set('Authorization', `Bearer ${student1Token}`)
        .send({
          categoryId: catId,
          title: 'Trying to inject status',
          description: 'Desc',
          status: 'resolved',
          currentAssignmentId: 'a0000000-0000-4000-8000-000000000099',
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Validation failed');
    });
  });

  describe('GET /api/v1/requests/me (Student Request Listing & Filtering)', () => {
    it('14. a student can retrieve their own requests', async () => {
      vi.spyOn(requestRepository, 'findStudentRequests').mockResolvedValueOnce({
        requests: [
          {
            id: reqId1,
            publicRef: 'REQ-2026-00001',
            title: 'Transcript',
            description: 'Desc',
            studentId: student1Id,
            categoryId: catId,
            responsibleDepartmentId: deptId,
            currentAuthorityLevelId: level1Id,
            currentAssignmentId: null,
            currentEscalationId: null,
            priority: 'medium',
            status: 'pending',
            dueAt: null,
            resolutionNotes: null,
            resolvedAt: null,
            closedAt: null,
            rejectedAt: null,
            reopenCount: 0,
            deletedAt: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
        total: 1,
      });

      const res = await request(app)
        .get('/api/v1/requests/me')
        .set('Authorization', `Bearer ${student1Token}`);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');
      expect(res.body.data.requests).toHaveLength(1);
      expect(res.body.data.requests[0].studentId).toBe(student1Id);
    });

    it('16. pagination works correctly and enforces maximum pagination limit of 100', async () => {
      const findSpy = vi.spyOn(requestRepository, 'findStudentRequests').mockResolvedValueOnce({
        requests: [],
        total: 250,
      });

      const res = await request(app)
        .get('/api/v1/requests/me?page=2&limit=50')
        .set('Authorization', `Bearer ${student1Token}`);

      expect(res.status).toBe(200);
      expect(res.body.data.page).toBe(2);
      expect(res.body.data.limit).toBe(50);
      expect(res.body.data.total).toBe(250);
      expect(res.body.data.totalPages).toBe(5);

      // Exceeding 100 limit returns 400
      const exceedRes = await request(app)
        .get('/api/v1/requests/me?limit=150')
        .set('Authorization', `Bearer ${student1Token}`);
      expect(exceedRes.status).toBe(400);
      expect(exceedRes.body.message).toContain('Limit must be between 1 and 100');
    });

    it('17. status and category filters work correctly', async () => {
      const findSpy = vi.spyOn(requestRepository, 'findStudentRequests').mockResolvedValueOnce({
        requests: [],
        total: 0,
      });

      const res = await request(app)
        .get(`/api/v1/requests/me?status=pending&categoryId=${catId}`)
        .set('Authorization', `Bearer ${student1Token}`);

      expect(res.status).toBe(200);
      expect(findSpy).toHaveBeenCalledWith(
        student1Id,
        expect.objectContaining({
          status: 'pending',
          categoryId: catId,
        }),
      );
    });

    it('18. invalid query parameters are handled with 400', async () => {
      const res1 = await request(app)
        .get('/api/v1/requests/me?status=nonexistent_status')
        .set('Authorization', `Bearer ${student1Token}`);
      expect(res1.status).toBe(400);

      const res2 = await request(app)
        .get('/api/v1/requests/me?page=-1')
        .set('Authorization', `Bearer ${student1Token}`);
      expect(res2.status).toBe(400);
    });
  });

  describe('GET /api/v1/requests/:requestId (Single Request Details)', () => {
    it('14 (cont). a student can retrieve details of their own request', async () => {
      vi.spyOn(requestRepository, 'findById').mockResolvedValueOnce({
        id: reqId1,
        publicRef: 'REQ-2026-00001',
        title: 'Transcript Request',
        description: 'Details',
        studentId: student1Id,
        categoryId: catId,
        responsibleDepartmentId: deptId,
        currentAuthorityLevelId: level1Id,
        currentAssignmentId: null,
        currentEscalationId: null,
        priority: 'medium',
        status: 'pending',
        dueAt: null,
        resolutionNotes: null,
        resolvedAt: null,
        closedAt: null,
        rejectedAt: null,
        reopenCount: 0,
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        student: { id: student1Id, fullName: 'Alice Student', email: 'student1@univoice.edu' },
        category: { id: catId, name: 'Official Transcript' },
        department: { id: deptId, name: 'Academic Registry', code: 'REGISTRY' },
        currentAuthorityLevel: { id: level1Id, name: 'Level 1 Intake', levelOrder: 1 },
      });

      const res = await request(app)
        .get(`/api/v1/requests/${reqId1}`)
        .set('Authorization', `Bearer ${student1Token}`);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');
      expect(res.body.data.request.id).toBe(reqId1);
      expect(res.body.data.request.publicRef).toBe('REQ-2026-00001');
    });

    it("15. a student cannot retrieve another student's requests (returns 404 without leaking info)", async () => {
      // reqId1 belongs to student1Id. student2Id requests it.
      vi.spyOn(requestRepository, 'findById').mockResolvedValueOnce({
        id: reqId1,
        publicRef: 'REQ-2026-00001',
        title: 'Alice Private Request',
        description: 'Private Details',
        studentId: student1Id,
        categoryId: catId,
        responsibleDepartmentId: deptId,
        currentAuthorityLevelId: level1Id,
        currentAssignmentId: null,
        currentEscalationId: null,
        priority: 'medium',
        status: 'pending',
        dueAt: null,
        resolutionNotes: null,
        resolvedAt: null,
        closedAt: null,
        rejectedAt: null,
        reopenCount: 0,
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const res = await request(app)
        .get(`/api/v1/requests/${reqId1}`)
        .set('Authorization', `Bearer ${student2Token}`);

      expect(res.status).toBe(404);
      expect(res.body.message).toBe('Request not found');
    });

    it('18 (cont). invalid request ID parameter format returns 400', async () => {
      const res = await request(app)
        .get('/api/v1/requests/not-a-uuid')
        .set('Authorization', `Bearer ${student1Token}`);

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Valid request ID is required');
    });
  });

  describe('Transaction Integrity & Error Handling', () => {
    it('19. a failure during insert rolls back request creation', async () => {
      vi.spyOn(requestRepository, 'lockAndGetCategoryRouting').mockResolvedValueOnce({
        categoryId: catId,
        categoryName: 'Cat',
        categoryIsActive: true,
        defaultPriority: 'medium',
        defaultDueHours: null,
        departmentId: deptId,
        departmentName: 'Dept',
        departmentCode: 'DEPT',
        departmentIsActive: true,
        authorityLevelId: level1Id,
        authorityLevelName: 'L1',
        authorityLevelOrder: 1,
        authorityLevelIsActive: true,
        authorityDepartmentId: deptId,
      });

      vi.spyOn(requestRepository, 'generatePublicRef').mockResolvedValueOnce('REQ-2026-00001');
      vi.spyOn(requestRepository, 'insertRequest').mockRejectedValueOnce(
        new Error('Database write collision or constraint failure'),
      );

      const res = await request(app)
        .post('/api/v1/requests')
        .set('Authorization', `Bearer ${student1Token}`)
        .send({
          categoryId: catId,
          title: 'Test Rollback',
          description: 'Desc',
        });

      expect(res.status).toBe(500);
      expect(mockClientQuery).toHaveBeenCalledWith('BEGIN');
      expect(mockClientQuery).toHaveBeenCalledWith('ROLLBACK');
      expect(mockClientRelease).toHaveBeenCalled();
    });

    it('20. database errors are handled without exposing sensitive internal information', async () => {
      vi.spyOn(requestRepository, 'lockAndGetCategoryRouting').mockRejectedValueOnce({
        code: '23503',
        message: 'insert or update on table "requests" violates foreign key constraint "requests_category_department_fk"',
      });

      const res = await request(app)
        .post('/api/v1/requests')
        .set('Authorization', `Bearer ${student1Token}`)
        .send({
          categoryId: catId,
          title: 'Test Sensitive Masking',
          description: 'Desc',
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Foreign key integrity violation');
      expect(res.body.message).not.toContain('table "requests"');
    });
  });
});
