import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../src/app';
import { signAccessToken } from '../../src/services/auth/token.service';
import { userRepository } from '../../src/repositories/user.repository';
import {
  staffQueueRepository,
  StaffQueueItemRecord,
  StaffAssignmentRecord,
} from '../../src/repositories/staffQueue.repository';

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

describe('Staff Request Queue & Claiming Endpoints (Phase 5)', () => {
  const staffUserId1 = 'a0000000-0000-4000-8000-000000000021';
  const staffUserId2 = 'a0000000-0000-4000-8000-000000000022';
  const studentUserId = 'a0000000-0000-4000-8000-000000000001';

  const dept1Id = 'a0000000-0000-4000-8000-000000000010';
  const dept2Id = 'a0000000-0000-4000-8000-000000000011';
  const catId = 'a0000000-0000-4000-8000-000000000041';
  const level1Id = 'a0000000-0000-4000-8000-000000000031';
  const reqId1 = 'a0000000-0000-4000-8000-000000000051';
  const reqId2 = 'a0000000-0000-4000-8000-000000000052';
  const assignmentId1 = 'a0000000-0000-4000-8000-000000000071';

  let staff1Token: string;
  let staff2Token: string;
  let studentToken: string;

  beforeEach(() => {
    vi.clearAllMocks();

    staff1Token = signAccessToken({
      sub: staffUserId1,
      email: 'staff1@univoice.edu',
      role: 'staff',
    });

    staff2Token = signAccessToken({
      sub: staffUserId2,
      email: 'staff2@univoice.edu',
      role: 'staff',
    });

    studentToken = signAccessToken({
      sub: studentUserId,
      email: 'student@univoice.edu',
      role: 'student',
    });

    vi.spyOn(userRepository, 'findById').mockImplementation(async (id: string) => {
      if (id === staffUserId1) {
        return {
          id: staffUserId1,
          firstName: 'Sarah',
          lastName: 'Officer',
          fullName: 'Sarah Officer',
          email: 'staff1@univoice.edu',
          role: 'staff',
          primaryDepartmentId: dept1Id,
          isActive: true,
        };
      }
      if (id === staffUserId2) {
        return {
          id: staffUserId2,
          firstName: 'John',
          lastName: 'Clerk',
          fullName: 'John Clerk',
          email: 'staff2@univoice.edu',
          role: 'staff',
          primaryDepartmentId: dept1Id,
          isActive: true,
        };
      }
      if (id === studentUserId) {
        return {
          id: studentUserId,
          firstName: 'Alice',
          lastName: 'Student',
          fullName: 'Alice Student',
          email: 'student@univoice.edu',
          role: 'student',
          primaryDepartmentId: null,
          isActive: true,
        };
      }
      return null;
    });
  });

  describe('GET /api/v1/staff/queue (Queue Discovery & Eligibility)', () => {
    const sampleQueueItem: StaffQueueItemRecord = {
      id: reqId1,
      publicRef: 'REQ-2026-00042',
      title: 'Transcript Verification Delay',
      description: 'Need urgent transcript verification for international admissions processing.',
      priority: 'urgent',
      status: 'pending',
      createdAt: new Date(Date.now() - 3600 * 1000),
      dueAt: new Date(Date.now() + 48 * 3600 * 1000),
      department: {
        id: dept1Id,
        name: 'Academic Registry',
        code: 'REGISTRY',
      },
      category: {
        id: catId,
        name: 'Official Transcript',
      },
      requiredAuthorityLevel: {
        id: level1Id,
        name: 'Level 1 Intake',
        levelOrder: 1,
      },
    };

    it('1. returns eligible requests for authenticated staff with preview and waiting duration', async () => {
      vi.spyOn(staffQueueRepository, 'findEligibleQueue').mockResolvedValueOnce({
        queue: [sampleQueueItem],
        total: 1,
      });

      const res = await request(app)
        .get('/api/v1/staff/queue')
        .set('Authorization', `Bearer ${staff1Token}`);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');
      expect(res.body.data.queue).toHaveLength(1);

      const item = res.body.data.queue[0];
      expect(item.id).toBe(reqId1);
      expect(item.publicRef).toBe('REQ-2026-00042');
      expect(item.priority).toBe('urgent');
      expect(item.status).toBe('pending');
      expect(item.descriptionPreview).toBe(sampleQueueItem.description);
      expect(item.waitingDurationSeconds).toBeGreaterThanOrEqual(3599);
      expect(item.department.code).toBe('REGISTRY');
      expect(item.category.name).toBe('Official Transcript');
      expect(item.requiredAuthorityLevel.levelOrder).toBe(1);
    });

    it('2. truncates descriptionPreview when length exceeds 150 characters', async () => {
      const longDesc = 'A'.repeat(200);
      vi.spyOn(staffQueueRepository, 'findEligibleQueue').mockResolvedValueOnce({
        queue: [{ ...sampleQueueItem, description: longDesc }],
        total: 1,
      });

      const res = await request(app)
        .get('/api/v1/staff/queue')
        .set('Authorization', `Bearer ${staff1Token}`);

      expect(res.status).toBe(200);
      expect(res.body.data.queue[0].descriptionPreview).toBe(`${'A'.repeat(150)}...`);
    });

    it('3. supports optional department filter', async () => {
      const queueSpy = vi
        .spyOn(staffQueueRepository, 'findEligibleQueue')
        .mockResolvedValueOnce({
          queue: [],
          total: 0,
        });

      const res = await request(app)
        .get(`/api/v1/staff/queue?departmentId=${dept2Id}`)
        .set('Authorization', `Bearer ${staff1Token}`);

      expect(res.status).toBe(200);
      expect(queueSpy).toHaveBeenCalledWith(
        staffUserId1,
        expect.objectContaining({ departmentId: dept2Id }),
      );
    });

    it('4. supports priority filtering', async () => {
      const queueSpy = vi
        .spyOn(staffQueueRepository, 'findEligibleQueue')
        .mockResolvedValueOnce({
          queue: [],
          total: 0,
        });

      const res = await request(app)
        .get('/api/v1/staff/queue?priority=urgent')
        .set('Authorization', `Bearer ${staff1Token}`);

      expect(res.status).toBe(200);
      expect(queueSpy).toHaveBeenCalledWith(
        staffUserId1,
        expect.objectContaining({ priority: 'urgent' }),
      );
    });

    it('5. enforces pagination boundaries and rejects limit exceeding 100 with 400', async () => {
      vi.spyOn(staffQueueRepository, 'findEligibleQueue').mockResolvedValueOnce({
        queue: [],
        total: 25,
      });

      const validRes = await request(app)
        .get('/api/v1/staff/queue?page=2&limit=10')
        .set('Authorization', `Bearer ${staff1Token}`);

      expect(validRes.status).toBe(200);
      expect(validRes.body.data.page).toBe(2);
      expect(validRes.body.data.limit).toBe(10);
      expect(validRes.body.data.total).toBe(25);
      expect(validRes.body.data.totalPages).toBe(3);

      const exceedRes = await request(app)
        .get('/api/v1/staff/queue?limit=150')
        .set('Authorization', `Bearer ${staff1Token}`);

      expect(exceedRes.status).toBe(400);
      expect(exceedRes.body.message).toContain('Limit must be between 1 and 100');
    });

    it('6. rejects unauthenticated users with 401 and students with 403', async () => {
      const unauthRes = await request(app).get('/api/v1/staff/queue');
      expect(unauthRes.status).toBe(401);

      const studentRes = await request(app)
        .get('/api/v1/staff/queue')
        .set('Authorization', `Bearer ${studentToken}`);
      expect(studentRes.status).toBe(403);
    });
  });

  describe('GET /api/v1/staff/queue/:requestId (Eligible Request Inspection)', () => {
    const sampleQueueItem: StaffQueueItemRecord = {
      id: reqId1,
      publicRef: 'REQ-2026-00042',
      title: 'Transcript Verification Delay',
      description: 'Full un-truncated description for detailed inspection.',
      priority: 'high',
      status: 'pending',
      createdAt: new Date(Date.now() - 1800 * 1000),
      dueAt: new Date(Date.now() + 24 * 3600 * 1000),
      department: {
        id: dept1Id,
        name: 'Academic Registry',
        code: 'REGISTRY',
      },
      category: {
        id: catId,
        name: 'Official Transcript',
      },
      requiredAuthorityLevel: {
        id: level1Id,
        name: 'Level 1 Intake',
        levelOrder: 1,
      },
    };

    it('7. returns full request details when staff is eligible', async () => {
      vi.spyOn(staffQueueRepository, 'findEligibleQueueItemById').mockResolvedValueOnce(sampleQueueItem);

      const res = await request(app)
        .get(`/api/v1/staff/queue/${reqId1}`)
        .set('Authorization', `Bearer ${staff1Token}`);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');
      expect(res.body.data.request.id).toBe(reqId1);
      expect(res.body.data.request.description).toBe(sampleQueueItem.description);
      expect(res.body.data.request.status).toBe('pending');
      expect(res.body.data.request.waitingDurationSeconds).toBeGreaterThanOrEqual(1799);
    });

    it('8. returns 404 when request is ineligible, not found, or in an unauthorized department', async () => {
      vi.spyOn(staffQueueRepository, 'findEligibleQueueItemById').mockResolvedValueOnce(null);

      const res = await request(app)
        .get(`/api/v1/staff/queue/${reqId2}`)
        .set('Authorization', `Bearer ${staff1Token}`);

      expect(res.status).toBe(404);
      expect(res.body.message).toBe('Request not found');
    });

    it('9. rejects invalid UUID parameter with 400', async () => {
      const res = await request(app)
        .get('/api/v1/staff/queue/not-a-uuid')
        .set('Authorization', `Bearer ${staff1Token}`);

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Valid request ID is required');
    });
  });

  describe('POST /api/v1/staff/requests/:requestId/claim (Request Claiming)', () => {
    it('10. successfully claims an eligible request inside transaction', async () => {
      vi.spyOn(staffQueueRepository, 'claimRequest').mockResolvedValueOnce({
        assignmentId: assignmentId1,
        request: {
          id: reqId1,
          publicRef: 'REQ-2026-00042',
          status: 'assigned',
          currentAssignmentId: assignmentId1,
          claimedAt: new Date(),
        },
      });

      const res = await request(app)
        .post(`/api/v1/staff/requests/${reqId1}/claim`)
        .set('Authorization', `Bearer ${staff1Token}`);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');
      expect(res.body.data.assignmentId).toBe(assignmentId1);
      expect(res.body.data.request.status).toBe('assigned');
      expect(res.body.data.request.currentAssignmentId).toBe(assignmentId1);
    });

    it('11. returns 409 Conflict when request is already claimed or no longer pending', async () => {
      vi.spyOn(staffQueueRepository, 'claimRequest').mockRejectedValueOnce(
        new Error('Request is not available to claim (status: assigned)'),
      );

      const res = await request(app)
        .post(`/api/v1/staff/requests/${reqId1}/claim`)
        .set('Authorization', `Bearer ${staff1Token}`);

      expect(res.status).toBe(409);
      expect(res.body.message).toContain('Request is no longer available to claim');
    });

    it('12. returns 409 Conflict when staff member has reached workload capacity in department', async () => {
      vi.spyOn(staffQueueRepository, 'claimRequest').mockRejectedValueOnce({
        code: '23514',
        message: 'Staff member is at capacity (5 active requests, limit is 5)',
      });

      const res = await request(app)
        .post(`/api/v1/staff/requests/${reqId1}/claim`)
        .set('Authorization', `Bearer ${staff1Token}`);

      expect(res.status).toBe(409);
      expect(res.body.message).toContain('active request capacity');
    });

    it('13. returns 403 Forbidden when staff is currently marked unavailable', async () => {
      vi.spyOn(staffQueueRepository, 'claimRequest').mockRejectedValueOnce(
        new Error('Staff member is currently marked unavailable in department'),
      );

      const res = await request(app)
        .post(`/api/v1/staff/requests/${reqId1}/claim`)
        .set('Authorization', `Bearer ${staff1Token}`);

      expect(res.status).toBe(403);
      expect(res.body.message).toContain('currently marked unavailable');
    });

    it('14. returns 403 Forbidden when staff authority level order is insufficient', async () => {
      vi.spyOn(staffQueueRepository, 'claimRequest').mockRejectedValueOnce(
        new Error('Staff authority level order (1) is insufficient for request authority level order (2)'),
      );

      const res = await request(app)
        .post(`/api/v1/staff/requests/${reqId1}/claim`)
        .set('Authorization', `Bearer ${staff1Token}`);

      expect(res.status).toBe(403);
      expect(res.body.message).toContain('authority level is insufficient');
    });

    it('15. returns 403 Forbidden when staff is not authorized for request category', async () => {
      vi.spyOn(staffQueueRepository, 'claimRequest').mockRejectedValueOnce(
        new Error('Staff member is not authorized to handle category'),
      );

      const res = await request(app)
        .post(`/api/v1/staff/requests/${reqId1}/claim`)
        .set('Authorization', `Bearer ${staff1Token}`);

      expect(res.status).toBe(403);
      expect(res.body.message).toContain('not authorized to handle requests in this category');
    });

    it('16. returns 403 Forbidden when staff does not hold active membership in request department', async () => {
      vi.spyOn(staffQueueRepository, 'claimRequest').mockRejectedValueOnce(
        new Error('Staff member is not an active member of department'),
      );

      const res = await request(app)
        .post(`/api/v1/staff/requests/${reqId1}/claim`)
        .set('Authorization', `Bearer ${staff1Token}`);

      expect(res.status).toBe(403);
      expect(res.body.message).toContain('do not hold active membership');
    });

    it('17. returns 404 Not Found when request does not exist or has been deleted', async () => {
      vi.spyOn(staffQueueRepository, 'claimRequest').mockRejectedValueOnce({
        code: 'no_data_found',
        message: 'Request does not exist',
      });

      const res = await request(app)
        .post(`/api/v1/staff/requests/${reqId1}/claim`)
        .set('Authorization', `Bearer ${staff1Token}`);

      expect(res.status).toBe(404);
      expect(res.body.message).toBe('Request not found');
    });

    it('18. rollback and release occur when claim transaction encounters unexpected failure', async () => {
      mockClientQuery.mockImplementation((sql: string) => {
        if (sql === 'BEGIN') return Promise.resolve();
        if (sql.includes('SELECT responsible_department_id')) {
          return Promise.resolve({
            rows: [{ responsible_department_id: dept1Id, status: 'pending', current_assignment_id: null, deleted_at: null }],
          });
        }
        if (sql.includes('SELECT 1 FROM staff_department_work_settings')) {
          return Promise.resolve({ rows: [{ '?column?': 1 }] });
        }
        if (sql.includes('SELECT claim_request')) {
          return Promise.reject(new Error('Internal deadlock or connection failure'));
        }
        if (sql === 'ROLLBACK') return Promise.resolve();
        return Promise.resolve({ rows: [] });
      });

      // Allow real repository claimRequest to run with mock client queries
      vi.spyOn(staffQueueRepository, 'claimRequest').mockRestore();

      const res = await request(app)
        .post(`/api/v1/staff/requests/${reqId1}/claim`)
        .set('Authorization', `Bearer ${staff1Token}`);

      expect(res.status).toBe(500);
      expect(mockClientQuery).toHaveBeenCalledWith('BEGIN');
      expect(mockClientQuery).toHaveBeenCalledWith('ROLLBACK');
      expect(mockClientRelease).toHaveBeenCalled();
    });
  });

  describe('GET /api/v1/staff/requests/me (My Active Assignments)', () => {
    const sampleAssignment: StaffAssignmentRecord = {
      assignmentId: assignmentId1,
      assignedAt: new Date(Date.now() - 7200 * 1000),
      source: 'claim',
      request: {
        id: reqId1,
        publicRef: 'REQ-2026-00042',
        title: 'Transcript Verification Delay',
        status: 'assigned',
        priority: 'urgent',
        dueAt: new Date(Date.now() + 48 * 3600 * 1000),
        department: {
          id: dept1Id,
          name: 'Academic Registry',
          code: 'REGISTRY',
        },
        category: {
          id: catId,
          name: 'Official Transcript',
        },
      },
    };

    it('19. returns only requests actively assigned to authenticated staff member', async () => {
      vi.spyOn(staffQueueRepository, 'findStaffActiveAssignments').mockResolvedValueOnce({
        assignments: [sampleAssignment],
        total: 1,
      });

      const res = await request(app)
        .get('/api/v1/staff/requests/me')
        .set('Authorization', `Bearer ${staff1Token}`);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');
      expect(res.body.data.assignments).toHaveLength(1);
      expect(res.body.data.assignments[0].assignmentId).toBe(assignmentId1);
      expect(res.body.data.assignments[0].request.id).toBe(reqId1);
      expect(res.body.data.assignments[0].request.status).toBe('assigned');
    });

    it('20. supports department and status filters with pagination', async () => {
      const assignSpy = vi
        .spyOn(staffQueueRepository, 'findStaffActiveAssignments')
        .mockResolvedValueOnce({
          assignments: [],
          total: 0,
        });

      const res = await request(app)
        .get(`/api/v1/staff/requests/me?departmentId=${dept1Id}&status=assigned&page=1&limit=20`)
        .set('Authorization', `Bearer ${staff1Token}`);

      expect(res.status).toBe(200);
      expect(assignSpy).toHaveBeenCalledWith(
        staffUserId1,
        expect.objectContaining({
          departmentId: dept1Id,
          status: 'assigned',
          page: 1,
          limit: 20,
        }),
      );
    });

    it('21. rejects students and unauthenticated users with 401 / 403', async () => {
      const unauthRes = await request(app).get('/api/v1/staff/requests/me');
      expect(unauthRes.status).toBe(401);

      const studentRes = await request(app)
        .get('/api/v1/staff/requests/me')
        .set('Authorization', `Bearer ${studentToken}`);
      expect(studentRes.status).toBe(403);
    });
  });
});
