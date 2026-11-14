import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../src/app';
import { signAccessToken } from '../../src/services/auth/token.service';
import { userRepository } from '../../src/repositories/user.repository';
import { requestWorkflowRepository } from '../../src/repositories/requestWorkflow.repository';
import { RequestRecord } from '../../src/repositories/request.repository';

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

describe('Staff Request Workflow Endpoints (Phase 6)', () => {
  const assignedStaffId = 'a0000000-0000-4000-8000-000000000021';
  const otherStaffId = 'a0000000-0000-4000-8000-000000000022';
  const studentId = 'a0000000-0000-4000-8000-000000000001';
  const requestId = 'a0000000-0000-4000-8000-000000000051';
  const assignmentId = 'a0000000-0000-4000-8000-000000000071';

  let assignedStaffToken: string;
  let otherStaffToken: string;
  let studentToken: string;

  const mockBaseRequest: RequestRecord = {
    id: requestId,
    publicRef: 'REQ-2026-00001',
    title: 'Grade Discrepancy',
    description: 'Exam score recorded incorrectly',
    studentId,
    categoryId: 'a0000000-0000-4000-8000-000000000041',
    responsibleDepartmentId: 'a0000000-0000-4000-8000-000000000010',
    currentAuthorityLevelId: 'a0000000-0000-4000-8000-000000000031',
    currentAssignmentId: assignmentId,
    currentEscalationId: null,
    priority: 'high',
    status: 'assigned',
    dueAt: null,
    resolutionCategory: null,
    resolutionNotes: null,
    resolvedAt: null,
    closedAt: null,
    firstClosedAt: null,
    rejectedAt: null,
    rejectionReason: null,
    reopenCount: 0,
    lastReopenReason: null,
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    vi.clearAllMocks();

    assignedStaffToken = signAccessToken({
      sub: assignedStaffId,
      email: 'assigned.staff@univoice.edu',
      role: 'staff',
    });

    otherStaffToken = signAccessToken({
      sub: otherStaffId,
      email: 'other.staff@univoice.edu',
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
      role: id === studentId ? 'student' : 'staff',
      isActive: true,
      firstName: 'Test',
      lastName: 'User',
      fullName: 'Test User',
      createdAt: new Date(),
      updatedAt: new Date(),
    }));
  });

  describe('PATCH /api/v1/staff/requests/:requestId/start', () => {
    it('1. assigned staff can start processing an assigned request', async () => {
      vi.spyOn(requestWorkflowRepository, 'startProcessing').mockResolvedValueOnce({
        ...mockBaseRequest,
        status: 'in_progress',
      });

      const res = await request(app)
        .patch(`/api/v1/staff/requests/${requestId}/start`)
        .set('Authorization', `Bearer ${assignedStaffToken}`);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');
      expect(res.body.data.request.status).toBe('in_progress');
    });

    it('2. returns 400 when attempting to start a pending request', async () => {
      const err = new Error("Request cannot be started from status 'pending'. Only 'assigned' requests can transition to 'in_progress'.");
      (err as unknown as { code: string }).code = 'invalid_transition';
      vi.spyOn(requestWorkflowRepository, 'startProcessing').mockRejectedValueOnce(err);

      const res = await request(app)
        .patch(`/api/v1/staff/requests/${requestId}/start`)
        .set('Authorization', `Bearer ${assignedStaffToken}`);

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('pending');
    });

    it('3. returns 400 when attempting to start an already resolved/closed/rejected request', async () => {
      const err = new Error("Request cannot be started from status 'closed'. Only 'assigned' requests can transition to 'in_progress'.");
      (err as unknown as { code: string }).code = 'invalid_transition';
      vi.spyOn(requestWorkflowRepository, 'startProcessing').mockRejectedValueOnce(err);

      const res = await request(app)
        .patch(`/api/v1/staff/requests/${requestId}/start`)
        .set('Authorization', `Bearer ${assignedStaffToken}`);

      expect(res.status).toBe(400);
    });

    it('4. returns 403 when another staff member attempts to start processing', async () => {
      const err = new Error('Only the currently assigned staff member can start processing this request');
      (err as unknown as { code: string }).code = 'forbidden';
      vi.spyOn(requestWorkflowRepository, 'startProcessing').mockRejectedValueOnce(err);

      const res = await request(app)
        .patch(`/api/v1/staff/requests/${requestId}/start`)
        .set('Authorization', `Bearer ${otherStaffToken}`);

      expect(res.status).toBe(403);
    });

    it('5. returns 404 when request does not exist', async () => {
      const err = new Error('Request not found');
      (err as unknown as { code: string }).code = 'not_found';
      vi.spyOn(requestWorkflowRepository, 'startProcessing').mockRejectedValueOnce(err);

      const res = await request(app)
        .patch(`/api/v1/staff/requests/${requestId}/start`)
        .set('Authorization', `Bearer ${assignedStaffToken}`);

      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/v1/staff/requests/:requestId/resolve', () => {
    it('6. valid resolution succeeds (transitions to resolved then closed)', async () => {
      vi.spyOn(requestWorkflowRepository, 'resolveRequest').mockResolvedValueOnce({
        ...mockBaseRequest,
        status: 'closed',
        currentAssignmentId: null,
        resolutionCategory: 'resolved_fully',
        resolutionNotes: 'Grade verified and corrected with instructor.',
        resolvedAt: new Date(),
        closedAt: new Date(),
        firstClosedAt: new Date(),
      });

      const res = await request(app)
        .post(`/api/v1/staff/requests/${requestId}/resolve`)
        .set('Authorization', `Bearer ${assignedStaffToken}`)
        .send({
          resolutionCategory: 'resolved_fully',
          resolutionMessage: 'Grade verified and corrected with instructor.',
        });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');
      expect(res.body.data.request.status).toBe('closed');
      expect(res.body.data.request.resolutionCategory).toBe('resolved_fully');
      expect(res.body.data.request.resolutionNotes).toBe('Grade verified and corrected with instructor.');
    });

    it('7. rejects missing or invalid resolutionCategory with 400', async () => {
      const missingCat = await request(app)
        .post(`/api/v1/staff/requests/${requestId}/resolve`)
        .set('Authorization', `Bearer ${assignedStaffToken}`)
        .send({
          resolutionMessage: 'Done',
        });
      expect(missingCat.status).toBe(400);

      const invalidCat = await request(app)
        .post(`/api/v1/staff/requests/${requestId}/resolve`)
        .set('Authorization', `Bearer ${assignedStaffToken}`)
        .send({
          resolutionCategory: 'not_a_real_category',
          resolutionMessage: 'Done',
        });
      expect(invalidCat.status).toBe(400);
    });

    it('8. rejects missing or blank resolutionMessage with 400', async () => {
      const missingMsg = await request(app)
        .post(`/api/v1/staff/requests/${requestId}/resolve`)
        .set('Authorization', `Bearer ${assignedStaffToken}`)
        .send({
          resolutionCategory: 'resolved_fully',
        });
      expect(missingMsg.status).toBe(400);

      const blankMsg = await request(app)
        .post(`/api/v1/staff/requests/${requestId}/resolve`)
        .set('Authorization', `Bearer ${assignedStaffToken}`)
        .send({
          resolutionCategory: 'resolved_fully',
          resolutionMessage: '   ',
        });
      expect(blankMsg.status).toBe(400);
    });

    it('9. returns 403 when another staff member attempts to resolve', async () => {
      const err = new Error('Only the currently assigned staff member can resolve this request');
      (err as unknown as { code: string }).code = 'forbidden';
      vi.spyOn(requestWorkflowRepository, 'resolveRequest').mockRejectedValueOnce(err);

      const res = await request(app)
        .post(`/api/v1/staff/requests/${requestId}/resolve`)
        .set('Authorization', `Bearer ${otherStaffToken}`)
        .send({
          resolutionCategory: 'resolved_fully',
          resolutionMessage: 'Resolving another staff request',
        });

      expect(res.status).toBe(403);
    });

    it('10. returns 400 when attempting to resolve a request not in_progress (e.g. assigned or closed)', async () => {
      const err = new Error("Request cannot be resolved from status 'assigned'. Only 'in_progress' requests can be resolved.");
      (err as unknown as { code: string }).code = 'invalid_transition';
      vi.spyOn(requestWorkflowRepository, 'resolveRequest').mockRejectedValueOnce(err);

      const res = await request(app)
        .post(`/api/v1/staff/requests/${requestId}/resolve`)
        .set('Authorization', `Bearer ${assignedStaffToken}`)
        .send({
          resolutionCategory: 'resolved_fully',
          resolutionMessage: 'Premature resolution',
        });

      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/v1/staff/requests/:requestId/reject', () => {
    it('11. assigned staff can reject an assigned request', async () => {
      vi.spyOn(requestWorkflowRepository, 'rejectRequest').mockResolvedValueOnce({
        ...mockBaseRequest,
        status: 'rejected',
        currentAssignmentId: null,
        rejectionReason: 'Request does not meet department submission criteria.',
        rejectedAt: new Date(),
      });

      const res = await request(app)
        .post(`/api/v1/staff/requests/${requestId}/reject`)
        .set('Authorization', `Bearer ${assignedStaffToken}`)
        .send({
          rejectionReason: 'Request does not meet department submission criteria.',
        });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');
      expect(res.body.data.request.status).toBe('rejected');
      expect(res.body.data.request.rejectionReason).toBe('Request does not meet department submission criteria.');
    });

    it('12. assigned staff can reject an in_progress request', async () => {
      vi.spyOn(requestWorkflowRepository, 'rejectRequest').mockResolvedValueOnce({
        ...mockBaseRequest,
        status: 'rejected',
        currentAssignmentId: null,
        rejectionReason: 'Ineligible after initial evaluation.',
        rejectedAt: new Date(),
      });

      const res = await request(app)
        .post(`/api/v1/staff/requests/${requestId}/reject`)
        .set('Authorization', `Bearer ${assignedStaffToken}`)
        .send({
          rejectionReason: 'Ineligible after initial evaluation.',
        });

      expect(res.status).toBe(200);
      expect(res.body.data.request.status).toBe('rejected');
    });

    it('13. rejects missing or blank rejectionReason with 400', async () => {
      const missingReason = await request(app)
        .post(`/api/v1/staff/requests/${requestId}/reject`)
        .set('Authorization', `Bearer ${assignedStaffToken}`)
        .send({});
      expect(missingReason.status).toBe(400);

      const blankReason = await request(app)
        .post(`/api/v1/staff/requests/${requestId}/reject`)
        .set('Authorization', `Bearer ${assignedStaffToken}`)
        .send({
          rejectionReason: '   ',
        });
      expect(blankReason.status).toBe(400);
    });

    it('14. returns 403 when another staff member attempts to reject', async () => {
      const err = new Error('Only the currently assigned staff member can reject this request');
      (err as unknown as { code: string }).code = 'forbidden';
      vi.spyOn(requestWorkflowRepository, 'rejectRequest').mockRejectedValueOnce(err);

      const res = await request(app)
        .post(`/api/v1/staff/requests/${requestId}/reject`)
        .set('Authorization', `Bearer ${otherStaffToken}`)
        .send({
          rejectionReason: 'Not my request',
        });

      expect(res.status).toBe(403);
    });

    it('15. rejects repeated rejection or rejecting a closed/pending request with 400', async () => {
      const err = new Error("Request cannot be rejected from status 'rejected'. Only 'assigned' or 'in_progress' requests can be rejected.");
      (err as unknown as { code: string }).code = 'invalid_transition';
      vi.spyOn(requestWorkflowRepository, 'rejectRequest').mockRejectedValueOnce(err);

      const res = await request(app)
        .post(`/api/v1/staff/requests/${requestId}/reject`)
        .set('Authorization', `Bearer ${assignedStaffToken}`)
        .send({
          rejectionReason: 'Double reject',
        });

      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/v1/staff/requests/:requestId/return (Phase 7)', () => {
    it('16. assigned staff can return request to queue with valid reason', async () => {
      vi.spyOn(requestWorkflowRepository, 'returnRequest').mockResolvedValueOnce({
        ...mockBaseRequest,
        status: 'pending',
        currentAssignmentId: null,
      });

      const res = await request(app)
        .post(`/api/v1/staff/requests/${requestId}/return`)
        .set('Authorization', `Bearer ${assignedStaffToken}`)
        .send({
          reason: 'Requires specialized subject matter expertise outside my current scope.',
        });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');
      expect(res.body.data.request.status).toBe('pending');
      expect(res.body.data.request.currentAssignmentId).toBeNull();
      expect(res.body.data.request.responsibleDepartmentId).toBe(mockBaseRequest.responsibleDepartmentId);
      expect(res.body.data.request.currentAuthorityLevelId).toBe(mockBaseRequest.currentAuthorityLevelId);
    });

    it('17. in-progress staff can return request to queue', async () => {
      vi.spyOn(requestWorkflowRepository, 'returnRequest').mockResolvedValueOnce({
        ...mockBaseRequest,
        status: 'pending',
        currentAssignmentId: null,
      });

      const res = await request(app)
        .post(`/api/v1/staff/requests/${requestId}/return`)
        .set('Authorization', `Bearer ${assignedStaffToken}`)
        .send({
          reason: 'Workload reassessment: passing back to department queue.',
        });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');
      expect(res.body.data.request.status).toBe('pending');
    });

    it('18. rejects missing or blank return reason with 400', async () => {
      const missingReason = await request(app)
        .post(`/api/v1/staff/requests/${requestId}/return`)
        .set('Authorization', `Bearer ${assignedStaffToken}`)
        .send({});
      expect(missingReason.status).toBe(400);
      expect(missingReason.body.message).toContain('Return reason is required');

      const blankReason = await request(app)
        .post(`/api/v1/staff/requests/${requestId}/return`)
        .set('Authorization', `Bearer ${assignedStaffToken}`)
        .send({
          reason: '   ',
        });
      expect(blankReason.status).toBe(400);
      expect(blankReason.body.message).toContain('Return reason is required');
    });

    it('19. returns 403 when another staff member attempts to return the request', async () => {
      const err = new Error('Only the currently assigned staff member can return this request to the queue');
      (err as unknown as { code: string }).code = 'insufficient_privilege';
      vi.spyOn(requestWorkflowRepository, 'returnRequest').mockRejectedValueOnce(err);

      const res = await request(app)
        .post(`/api/v1/staff/requests/${requestId}/return`)
        .set('Authorization', `Bearer ${otherStaffToken}`)
        .send({
          reason: 'Attempting return on unowned request',
        });

      expect(res.status).toBe(403);
      expect(res.body.message).toContain('Only the currently assigned staff member');
    });

    it('20. returns 400 when returning a request that is not assigned or in_progress', async () => {
      const err = new Error('Only actively assigned requests can be returned to queue (current status: pending)');
      (err as unknown as { code: string }).code = 'object_not_in_prerequisite_state';
      vi.spyOn(requestWorkflowRepository, 'returnRequest').mockRejectedValueOnce(err);

      const res = await request(app)
        .post(`/api/v1/staff/requests/${requestId}/return`)
        .set('Authorization', `Bearer ${assignedStaffToken}`)
        .send({
          reason: 'Returning already returned request',
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Only actively assigned requests can be returned');
    });

    it('21. returns 404 when request does not exist or is soft-deleted', async () => {
      const err = new Error(`Request ${requestId} does not exist`);
      (err as unknown as { code: string }).code = 'no_data_found';
      vi.spyOn(requestWorkflowRepository, 'returnRequest').mockRejectedValueOnce(err);

      const res = await request(app)
        .post(`/api/v1/staff/requests/${requestId}/return`)
        .set('Authorization', `Bearer ${assignedStaffToken}`)
        .send({
          reason: 'Valid reason on missing request',
        });

      expect(res.status).toBe(404);
      expect(res.body.message).toBe('Request not found');
    });

    it('22. returns 401 when unauthenticated and 403 when user is not staff', async () => {
      const unauth = await request(app)
        .post(`/api/v1/staff/requests/${requestId}/return`)
        .send({ reason: 'Valid reason' });
      expect(unauth.status).toBe(401);

      const studentRes = await request(app)
        .post(`/api/v1/staff/requests/${requestId}/return`)
        .set('Authorization', `Bearer ${studentToken}`)
        .send({ reason: 'Student trying to return' });
      expect(studentRes.status).toBe(403);
    });
  });

  describe('POST /api/v1/staff/requests/:requestId/escalate (Phase 7)', () => {
    const higherLevelId = 'a0000000-0000-4000-8000-000000000032';
    const escalationId = 'a0000000-0000-4000-8000-000000000081';

    it('23. assigned staff can escalate request to next authority queue', async () => {
      vi.spyOn(requestWorkflowRepository, 'escalateRequest').mockResolvedValueOnce({
        escalationId,
        request: {
          ...mockBaseRequest,
          status: 'pending',
          currentAuthorityLevelId: higherLevelId,
          currentAssignmentId: null,
          currentEscalationId: escalationId,
        },
      });

      const res = await request(app)
        .post(`/api/v1/staff/requests/${requestId}/escalate`)
        .set('Authorization', `Bearer ${assignedStaffToken}`)
        .send({
          reason: 'Requires Department Head approval for grade change exception.',
        });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');
      expect(res.body.data.escalationId).toBe(escalationId);
      expect(res.body.data.request.status).toBe('pending');
      expect(res.body.data.request.currentAuthorityLevelId).toBe(higherLevelId);
      expect(res.body.data.request.currentAssignmentId).toBeNull();
      expect(res.body.data.request.currentEscalationId).toBe(escalationId);
    });

    it('24. in-progress staff can escalate request with optional notes', async () => {
      vi.spyOn(requestWorkflowRepository, 'escalateRequest').mockResolvedValueOnce({
        escalationId,
        request: {
          ...mockBaseRequest,
          status: 'pending',
          currentAuthorityLevelId: higherLevelId,
          currentAssignmentId: null,
          currentEscalationId: escalationId,
        },
      });

      const res = await request(app)
        .post(`/api/v1/staff/requests/${requestId}/escalate`)
        .set('Authorization', `Bearer ${assignedStaffToken}`)
        .send({
          reason: 'Beyond L1 authority threshold',
          notes: 'Instructor confirmed review required by chair.',
        });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');
      expect(res.body.data.escalationId).toBe(escalationId);
    });

    it('25. rejects missing or blank escalation reason with 400', async () => {
      const missingReason = await request(app)
        .post(`/api/v1/staff/requests/${requestId}/escalate`)
        .set('Authorization', `Bearer ${assignedStaffToken}`)
        .send({});
      expect(missingReason.status).toBe(400);
      expect(missingReason.body.message).toContain('Escalation reason is required');

      const blankReason = await request(app)
        .post(`/api/v1/staff/requests/${requestId}/escalate`)
        .set('Authorization', `Bearer ${assignedStaffToken}`)
        .send({
          reason: '   ',
        });
      expect(blankReason.status).toBe(400);
      expect(blankReason.body.message).toContain('Escalation reason is required');
    });

    it('26. returns 403 when another staff member attempts to escalate the request', async () => {
      const err = new Error('Only the currently assigned staff member can escalate this request');
      (err as unknown as { code: string }).code = 'insufficient_privilege';
      vi.spyOn(requestWorkflowRepository, 'escalateRequest').mockRejectedValueOnce(err);

      const res = await request(app)
        .post(`/api/v1/staff/requests/${requestId}/escalate`)
        .set('Authorization', `Bearer ${otherStaffToken}`)
        .send({
          reason: 'Unauthorized escalation attempt',
        });

      expect(res.status).toBe(403);
      expect(res.body.message).toContain('Only the currently assigned staff member');
    });

    it('27. returns 400 when escalation at highest authority level is attempted', async () => {
      const err = new Error('Request is already at the highest authority level for this department');
      (err as unknown as { code: string }).code = 'check_violation';
      vi.spyOn(requestWorkflowRepository, 'escalateRequest').mockRejectedValueOnce(err);

      const res = await request(app)
        .post(`/api/v1/staff/requests/${requestId}/escalate`)
        .set('Authorization', `Bearer ${assignedStaffToken}`)
        .send({
          reason: 'Trying to escalate top tier',
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Request is already at the highest authority level');
    });

    it('28. returns 400 when attempting to escalate a request not actively assigned', async () => {
      const err = new Error('Only actively assigned requests can be escalated (current status: pending)');
      (err as unknown as { code: string }).code = 'object_not_in_prerequisite_state';
      vi.spyOn(requestWorkflowRepository, 'escalateRequest').mockRejectedValueOnce(err);

      const res = await request(app)
        .post(`/api/v1/staff/requests/${requestId}/escalate`)
        .set('Authorization', `Bearer ${assignedStaffToken}`)
        .send({
          reason: 'Escalating unassigned request',
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Only actively assigned requests can be escalated');
    });

    it('29. returns 404 when request does not exist or has been deleted', async () => {
      const err = new Error(`Request ${requestId} does not exist`);
      (err as unknown as { code: string }).code = 'no_data_found';
      vi.spyOn(requestWorkflowRepository, 'escalateRequest').mockRejectedValueOnce(err);

      const res = await request(app)
        .post(`/api/v1/staff/requests/${requestId}/escalate`)
        .set('Authorization', `Bearer ${assignedStaffToken}`)
        .send({
          reason: 'Escalating nonexistent request',
        });

      expect(res.status).toBe(404);
      expect(res.body.message).toBe('Request not found');
    });
  });

  describe('RequestWorkflowRepository transactional execution (Phase 7)', () => {
    it('30. returnRequest executes return_request_to_queue procedure in transaction and commits', async () => {
      mockClientQuery.mockImplementation((sql: string) => {
        if (sql === 'BEGIN') return Promise.resolve();
        if (sql.includes('SELECT return_request_to_queue')) {
          return Promise.resolve({ rows: [{ return_request_to_queue: assignmentId }] });
        }
        if (sql === 'COMMIT') return Promise.resolve();
        return Promise.resolve({ rows: [] });
      });

      vi.spyOn(requestWorkflowRepository, 'returnRequest').mockRestore();

      // Mock requestRepository.findById
      const { requestRepository } = await import('../../src/repositories/request.repository');
      vi.spyOn(requestRepository, 'findById').mockResolvedValueOnce({
        ...mockBaseRequest,
        status: 'pending',
        currentAssignmentId: null,
      });

      const result = await requestWorkflowRepository.returnRequest(
        requestId,
        assignedStaffId,
        { reason: 'Transactional return test' },
      );

      expect(result.status).toBe('pending');
      expect(result.currentAssignmentId).toBeNull();
      expect(mockClientQuery).toHaveBeenCalledWith('BEGIN');
      expect(mockClientQuery).toHaveBeenCalledWith('COMMIT');
    });

    it('31. returnRequest rolls back and releases client when procedure fails', async () => {
      mockClientQuery.mockImplementation((sql: string) => {
        if (sql === 'BEGIN') return Promise.resolve();
        if (sql.includes('SELECT return_request_to_queue')) {
          const err = new Error('Only the currently assigned staff member can return this request to the queue');
          (err as unknown as { code: string }).code = '42501';
          return Promise.reject(err);
        }
        if (sql === 'ROLLBACK') return Promise.resolve();
        return Promise.resolve({ rows: [] });
      });

      vi.spyOn(requestWorkflowRepository, 'returnRequest').mockRestore();

      await expect(
        requestWorkflowRepository.returnRequest(requestId, otherStaffId, {
          reason: 'Failed return attempt',
        }),
      ).rejects.toThrow('Only the currently assigned staff member');

      expect(mockClientQuery).toHaveBeenCalledWith('ROLLBACK');
      expect(mockClientRelease).toHaveBeenCalled();
    });

    it('32. escalateRequest executes escalate_request_to_queue procedure in transaction and commits', async () => {
      const higherLevelId = 'a0000000-0000-4000-8000-000000000032';
      const escalationId = 'a0000000-0000-4000-8000-000000000081';

      mockClientQuery.mockImplementation((sql: string) => {
        if (sql === 'BEGIN') return Promise.resolve();
        if (sql.includes('SELECT escalate_request_to_queue')) {
          return Promise.resolve({ rows: [{ escalationId }] });
        }
        if (sql === 'COMMIT') return Promise.resolve();
        return Promise.resolve({ rows: [] });
      });

      vi.spyOn(requestWorkflowRepository, 'escalateRequest').mockRestore();

      const { requestRepository } = await import('../../src/repositories/request.repository');
      vi.spyOn(requestRepository, 'findById').mockResolvedValueOnce({
        ...mockBaseRequest,
        status: 'pending',
        currentAuthorityLevelId: higherLevelId,
        currentAssignmentId: null,
        currentEscalationId: escalationId,
      });

      const result = await requestWorkflowRepository.escalateRequest(
        requestId,
        assignedStaffId,
        { reason: 'Transactional escalation test', notes: 'Urgent review' },
      );

      expect(result.escalationId).toBe(escalationId);
      expect(result.request.status).toBe('pending');
      expect(result.request.currentAuthorityLevelId).toBe(higherLevelId);
      expect(mockClientQuery).toHaveBeenCalledWith('BEGIN');
      expect(mockClientQuery).toHaveBeenCalledWith('COMMIT');
    });

    it('33. escalateRequest rolls back and releases client when procedure fails', async () => {
      mockClientQuery.mockImplementation((sql: string) => {
        if (sql === 'BEGIN') return Promise.resolve();
        if (sql.includes('SELECT escalate_request_to_queue')) {
          const err = new Error('Request is already at the highest authority level for this department');
          (err as unknown as { code: string }).code = '23514';
          return Promise.reject(err);
        }
        if (sql === 'ROLLBACK') return Promise.resolve();
        return Promise.resolve({ rows: [] });
      });

      vi.spyOn(requestWorkflowRepository, 'escalateRequest').mockRestore();

      await expect(
        requestWorkflowRepository.escalateRequest(requestId, assignedStaffId, {
          reason: 'Failed top-level escalation',
        }),
      ).rejects.toThrow('Request is already at the highest authority level');

      expect(mockClientQuery).toHaveBeenCalledWith('ROLLBACK');
      expect(mockClientRelease).toHaveBeenCalled();
    });
  });
});
