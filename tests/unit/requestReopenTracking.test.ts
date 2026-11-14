import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../src/app';
import { signAccessToken } from '../../src/services/auth/token.service';
import { userRepository } from '../../src/repositories/user.repository';
import { requestRepository, RequestRecord } from '../../src/repositories/request.repository';
import { requestWorkflowRepository } from '../../src/repositories/requestWorkflow.repository';
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

describe('Student Reopening & Request Tracking (Phase 6)', () => {
  const student1Id = 'a0000000-0000-4000-8000-000000000001';
  const student2Id = 'a0000000-0000-4000-8000-000000000002';
  const staffId = 'a0000000-0000-4000-8000-000000000021';
  const requestId = 'a0000000-0000-4000-8000-000000000051';

  let student1Token: string;
  let student2Token: string;
  let staffToken: string;

  const mockClosedRequest: RequestRecord = {
    id: requestId,
    publicRef: 'REQ-2026-00001',
    title: 'Financial Aid Appeal',
    description: 'Appeal for tuition waiver',
    studentId: student1Id,
    categoryId: 'a0000000-0000-4000-8000-000000000041',
    responsibleDepartmentId: 'a0000000-0000-4000-8000-000000000010',
    currentAuthorityLevelId: 'a0000000-0000-4000-8000-000000000032',
    currentAssignmentId: null,
    currentEscalationId: null,
    priority: 'high',
    status: 'closed',
    dueAt: null,
    resolutionCategory: 'resolved_fully',
    resolutionNotes: 'Waiver approved and posted to ledger.',
    resolvedAt: new Date(Date.now() - 2 * 24 * 3600 * 1000), // 2 days ago
    closedAt: new Date(Date.now() - 2 * 24 * 3600 * 1000),
    firstClosedAt: new Date(Date.now() - 2 * 24 * 3600 * 1000),
    rejectedAt: null,
    rejectionReason: null,
    reopenCount: 0,
    lastReopenReason: null,
    deletedAt: null,
    createdAt: new Date(Date.now() - 5 * 24 * 3600 * 1000),
    updatedAt: new Date(Date.now() - 2 * 24 * 3600 * 1000),
    department: {
      id: 'a0000000-0000-4000-8000-000000000010',
      name: 'Student Finance',
      code: 'FINANCE',
    },
    category: {
      id: 'a0000000-0000-4000-8000-000000000041',
      name: 'Fee Appeals',
    },
    currentAuthorityLevel: {
      id: 'a0000000-0000-4000-8000-000000000032',
      name: 'Senior Finance Officer',
      levelOrder: 2,
    },
  };

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
      sub: staffId,
      email: 'staff@univoice.edu',
      role: 'staff',
    });

    vi.spyOn(userRepository, 'findById').mockImplementation(async (id: string) => ({
      id,
      email: 'test@univoice.edu',
      role: id === staffId ? 'staff' : 'student',
      isActive: true,
      firstName: 'Test',
      lastName: 'User',
      fullName: 'Test User',
      createdAt: new Date(),
      updatedAt: new Date(),
    }));

    vi.spyOn(systemSettingsRepository, 'getWorkflowSettings').mockResolvedValue({
      reopenWindowDays: 7,
      maxReopenCount: 2,
    });
  });

  describe('POST /api/v1/requests/:requestId/reopen (Deprecated in Phase 7 Milestone 2)', () => {
    it('1. student-initiated reopening returns 410 Gone', async () => {
      const res = await request(app)
        .post(`/api/v1/requests/${requestId}/reopen`)
        .set('Authorization', `Bearer ${student1Token}`)
        .send({
          reason: 'Amount deducted still differs from waiver notice.',
        });

      expect(res.status).toBe(410);
      expect(res.body.status).toBe('error');
      expect(res.body.message).toContain('no longer available');
    });

    it('2. unauthenticated request returns 410 Gone (deprecated endpoint)', async () => {
      const res = await request(app)
        .post(`/api/v1/requests/${requestId}/reopen`)
        .send({
          reason: 'Trying to reopen without auth',
        });

      expect(res.status).toBe(410);
      expect(res.body.message).toContain('no longer available');
    });
  });

  describe('GET /api/v1/requests/:requestId (Student Tracking & Workflow History)', () => {
    it('8. student sees complete relevant workflow tracking details, history, and reopen eligibility', async () => {
      vi.spyOn(requestRepository, 'findById').mockResolvedValueOnce(mockClosedRequest);
      vi.spyOn(requestRepository, 'getAssignedOrLastStaff').mockResolvedValueOnce({
        fullName: 'Dr. Officer',
        email: 'officer@univoice.edu',
      });
      vi.spyOn(requestRepository, 'findStudentHistory').mockResolvedValueOnce([
        {
          id: 'hist-1',
          action: 'submitted',
          status: 'pending',
          timestamp: new Date(Date.now() - 5 * 24 * 3600 * 1000),
        },
        {
          id: 'hist-2',
          action: 'claimed',
          status: 'assigned',
          actorRole: 'staff',
          actorName: 'Dr. Officer',
          timestamp: new Date(Date.now() - 4 * 24 * 3600 * 1000),
        },
        {
          id: 'hist-3',
          action: 'status_changed',
          status: 'resolved',
          actorRole: 'staff',
          actorName: 'Dr. Officer',
          timestamp: new Date(Date.now() - 2 * 24 * 3600 * 1000),
          details: {
            resolutionCategory: 'resolved_fully',
            resolutionNotes: 'Waiver approved and posted to ledger.',
          },
        },
        {
          id: 'hist-4',
          action: 'status_changed',
          status: 'closed',
          timestamp: new Date(Date.now() - 2 * 24 * 3600 * 1000),
        },
      ]);

      const res = await request(app)
        .get(`/api/v1/requests/${requestId}`)
        .set('Authorization', `Bearer ${student1Token}`);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');

      const reqData = res.body.data.request;
      expect(reqData.publicRef).toBe('REQ-2026-00001');
      expect(reqData.title).toBe('Financial Aid Appeal');
      expect(reqData.status).toBe('closed');
      expect(reqData.department.name).toBe('Student Finance');
      expect(reqData.assignedStaff).toEqual({
        fullName: 'Dr. Officer',
        email: 'officer@univoice.edu',
      });
      expect(reqData.resolution).toEqual({
        category: 'resolved_fully',
        message: 'Waiver approved and posted to ledger.',
      });
      expect(reqData.reopening.isAllowed).toBe(true);
      expect(reqData.reopening.remainingReopenings).toBe(2);
      expect(reqData.reopening.windowExpiresAt).toBeDefined();
      expect(reqData.reopening.remainingWindowSeconds).toBeGreaterThan(0);
      expect(reqData.history).toHaveLength(4);
    });

    it('9. student tracking returns rejection reason when request was rejected', async () => {
      vi.spyOn(requestRepository, 'findById').mockResolvedValueOnce({
        ...mockClosedRequest,
        status: 'rejected',
        rejectedAt: new Date(),
        rejectionReason: 'Documentation incomplete. Resubmission required next term.',
      });
      vi.spyOn(requestRepository, 'getAssignedOrLastStaff').mockResolvedValueOnce({
        fullName: 'Dr. Officer',
        email: 'officer@univoice.edu',
      });
      vi.spyOn(requestRepository, 'findStudentHistory').mockResolvedValueOnce([]);

      const res = await request(app)
        .get(`/api/v1/requests/${requestId}`)
        .set('Authorization', `Bearer ${student1Token}`);

      expect(res.status).toBe(200);
      expect(res.body.data.request.status).toBe('rejected');
      expect(res.body.data.request.rejection).toEqual({
        reason: 'Documentation incomplete. Resubmission required next term.',
      });
      expect(res.body.data.request.reopening.isAllowed).toBe(false);
    });

    it("10. student cannot view another student's request tracking (404 without leaking data)", async () => {
      vi.spyOn(requestRepository, 'findById').mockResolvedValueOnce(mockClosedRequest);

      // Student 2 attempts to view Student 1's request
      const res = await request(app)
        .get(`/api/v1/requests/${requestId}`)
        .set('Authorization', `Bearer ${student2Token}`);

      expect(res.status).toBe(404);
      expect(res.body.message).toContain('not found');
    });
  });
});
