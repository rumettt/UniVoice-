import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../src/app';
import { signAccessToken } from '../../src/services/auth/token.service';
import { userRepository } from '../../src/repositories/user.repository';
import { requestRepository, RequestRecord } from '../../src/repositories/request.repository';
import { requestWorkflowRepository } from '../../src/repositories/requestWorkflow.repository';
import { messagingRepository, CommentRecord, AttachmentRecord } from '../../src/repositories/messaging.repository';
import { systemSettingsRepository } from '../../src/repositories/systemSettings.repository';
import { storageAdapter } from '../../src/utils/storage';

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
    STORAGE_LOCAL_DIR: './uploads/test',
    STORAGE_MAX_FILE_SIZE_BYTES: 10485760,
  },
}));

describe('Closed-Request Messaging & Staff Decisions (Phase 7 Milestone 2)', () => {
  const student1Id = 'a0000000-0000-4000-8000-000000000001';
  const student2Id = 'a0000000-0000-4000-8000-000000000002';
  const staff1Id = 'a0000000-0000-4000-8000-000000000021';
  const staff2Id = 'a0000000-0000-4000-8000-000000000022';
  const adminId = 'a0000000-0000-4000-8000-000000000099';
  const requestId = 'a0000000-0000-4000-8000-000000000051';
  const attachmentId = 'a0000000-0000-4000-8000-000000000088';

  let student1Token: string;
  let student2Token: string;
  let staff1Token: string;
  let staff2Token: string;
  let adminToken: string;

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
    resolutionNotes: 'Waiver approved.',
    resolvedAt: new Date(Date.now() - 2 * 24 * 3600 * 1000),
    closedAt: new Date(Date.now() - 2 * 24 * 3600 * 1000),
    firstClosedAt: new Date(Date.now() - 2 * 24 * 3600 * 1000),
    rejectedAt: null,
    rejectionReason: null,
    reopenCount: 0,
    lastReopenReason: null,
    deletedAt: null,
    createdAt: new Date(Date.now() - 5 * 24 * 3600 * 1000),
    updatedAt: new Date(Date.now() - 2 * 24 * 3600 * 1000),
  };

  const sampleComment: CommentRecord = {
    id: 'c0000000-0000-4000-8000-000000000001',
    requestId,
    authorId: student1Id,
    authorName: 'Student One',
    authorRole: 'student',
    content: 'Could I please get a copy of the official confirmation letter?',
    visibility: 'student_visible',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockClientQuery.mockResolvedValue({ rows: [] });
    mockQuery.mockResolvedValue({ rows: [] });

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

    staff1Token = signAccessToken({
      sub: staff1Id,
      email: 'staff1@univoice.edu',
      role: 'staff',
    });

    staff2Token = signAccessToken({
      sub: staff2Id,
      email: 'staff2@univoice.edu',
      role: 'staff',
    });

    adminToken = signAccessToken({
      sub: adminId,
      email: 'admin@univoice.edu',
      role: 'admin',
    });

    vi.spyOn(userRepository, 'findById').mockImplementation(async (id: string) => ({
      id,
      email: 'test@univoice.edu',
      role: id === adminId ? 'admin' : id === staff1Id || id === staff2Id ? 'staff' : 'student',
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

  describe('Student Closed-Request Messaging', () => {
    it('1. student can send a message on their own closed request', async () => {
      mockClientQuery.mockImplementation(async (sql: string) => {
        if (typeof sql === 'string' && sql.includes('FOR UPDATE')) {
          return {
            rows: [{ id: requestId, student_id: student1Id, status: 'closed', deleted_at: null }],
          };
        }
        return { rows: [] };
      });
      vi.spyOn(messagingRepository, 'insertComment').mockResolvedValueOnce(sampleComment);

      const res = await request(app)
        .post(`/api/v1/requests/${requestId}/messages`)
        .set('Authorization', `Bearer ${student1Token}`)
        .send({ content: 'Could I please get a copy of the official confirmation letter?' });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('success');
      expect(res.body.data.message.content).toBe('Could I please get a copy of the official confirmation letter?');
    });

    it('2. student cannot message a request that is still pending or open (400)', async () => {
      mockClientQuery.mockImplementation(async (sql: string) => {
        if (typeof sql === 'string' && sql.includes('FOR UPDATE')) {
          return {
            rows: [{ id: requestId, student_id: student1Id, status: 'assigned', deleted_at: null }],
          };
        }
        return { rows: [] };
      });

      const res = await request(app)
        .post(`/api/v1/requests/${requestId}/messages`)
        .set('Authorization', `Bearer ${student1Token}`)
        .send({ content: 'Status check please' });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('closed requests');
    });

    it("3. student cannot message another student's request (404 without data leak)", async () => {
      mockClientQuery.mockImplementation(async (sql: string) => {
        if (typeof sql === 'string' && sql.includes('FOR UPDATE')) {
          return {
            rows: [{ id: requestId, student_id: student1Id, status: 'closed', deleted_at: null }],
          };
        }
        return { rows: [] };
      });

      const res = await request(app)
        .post(`/api/v1/requests/${requestId}/messages`)
        .set('Authorization', `Bearer ${student2Token}`)
        .send({ content: 'Trying to snoop' });

      expect(res.status).toBe(404);
      expect(res.body.message).toContain('not found');
    });

    it('4. rejects empty or whitespace-only messages with 400', async () => {
      const res = await request(app)
        .post(`/api/v1/requests/${requestId}/messages`)
        .set('Authorization', `Bearer ${student1Token}`)
        .send({ content: '   ' });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('cannot be blank');
    });

    it('5. student can retrieve conversation on their own closed request', async () => {
      vi.spyOn(requestRepository, 'findById').mockResolvedValueOnce(mockClosedRequest);
      vi.spyOn(messagingRepository, 'getStudentVisibleMessages').mockResolvedValueOnce({
        messages: [sampleComment],
        total: 1,
      });

      const res = await request(app)
        .get(`/api/v1/requests/${requestId}/messages`)
        .set('Authorization', `Bearer ${student1Token}`);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');
      expect(res.body.data.messages).toHaveLength(1);
      expect(res.body.data.total).toBe(1);
    });

    it("6. student cannot retrieve conversation of another student's request (404)", async () => {
      vi.spyOn(requestRepository, 'findById').mockResolvedValueOnce(mockClosedRequest);

      const res = await request(app)
        .get(`/api/v1/requests/${requestId}/messages`)
        .set('Authorization', `Bearer ${student2Token}`);

      expect(res.status).toBe(404);
      expect(res.body.message).toContain('not found');
    });
  });

  describe('Staff Messaging & Decisions', () => {
    it('7. last handler staff can retrieve conversation', async () => {
      vi.spyOn(messagingRepository, 'getLastHandler').mockResolvedValueOnce({
        staffUserId: staff1Id,
        departmentId: 'a0000000-0000-4000-8000-000000000010',
        startedAt: new Date(),
        endedAt: new Date(),
      });
      vi.spyOn(messagingRepository, 'getStudentVisibleMessages').mockResolvedValueOnce({
        messages: [sampleComment],
        total: 1,
      });

      const res = await request(app)
        .get(`/api/v1/staff/requests/${requestId}/messages`)
        .set('Authorization', `Bearer ${staff1Token}`);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');
      expect(res.body.data.messages).toHaveLength(1);
    });

    it('8. staff who was NOT the last handler cannot view conversation (403)', async () => {
      vi.spyOn(messagingRepository, 'getLastHandler').mockResolvedValueOnce({
        staffUserId: staff1Id,
        departmentId: 'a0000000-0000-4000-8000-000000000010',
        startedAt: new Date(),
        endedAt: new Date(),
      });

      const res = await request(app)
        .get(`/api/v1/staff/requests/${requestId}/messages`)
        .set('Authorization', `Bearer ${staff2Token}`);

      expect(res.status).toBe(403);
      expect(res.body.message).toContain('last handler');
    });

    it('9. last handler staff can reply and request stays closed', async () => {
      mockClientQuery.mockImplementation(async (sql: string) => {
        if (typeof sql === 'string' && sql.includes('FOR UPDATE')) {
          return {
            rows: [{ id: requestId, status: 'closed', deleted_at: null }],
          };
        }
        return { rows: [] };
      });
      vi.spyOn(messagingRepository, 'getLastHandler').mockResolvedValueOnce({
        staffUserId: staff1Id,
        departmentId: 'a0000000-0000-4000-8000-000000000010',
        startedAt: new Date(),
        endedAt: new Date(),
      });
      vi.spyOn(messagingRepository, 'insertComment').mockResolvedValueOnce({
        id: 'c0000000-0000-4000-8000-000000000002',
        requestId,
        authorId: staff1Id,
        authorName: 'Staff One',
        authorRole: 'staff',
        content: 'Letter attached for your records.',
        visibility: 'student_visible',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const res = await request(app)
        .post(`/api/v1/staff/requests/${requestId}/messages`)
        .set('Authorization', `Bearer ${staff1Token}`)
        .send({ content: 'Letter attached for your records.' });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('success');
      expect(res.body.data.message.content).toBe('Letter attached for your records.');
    });

    it('10. last handler staff can reopen the closed request with valid reason', async () => {
      vi.spyOn(messagingRepository, 'getLastHandler').mockResolvedValueOnce({
        staffUserId: staff1Id,
        departmentId: 'a0000000-0000-4000-8000-000000000010',
        startedAt: new Date(),
        endedAt: new Date(),
      });
      vi.spyOn(requestWorkflowRepository, 'reopenRequestByStaff').mockResolvedValueOnce({
        ...mockClosedRequest,
        status: 'pending',
        currentAssignmentId: null,
        reopenCount: 1,
        lastReopenReason: 'Reopening to re-issue adjusted bursary voucher.',
      });

      const res = await request(app)
        .post(`/api/v1/staff/requests/${requestId}/reopen-closed`)
        .set('Authorization', `Bearer ${staff1Token}`)
        .send({ reason: 'Reopening to re-issue adjusted bursary voucher.' });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');
      expect(res.body.data.status).toBe('pending');
    });

    it('11. staff reopen fails if reopen count limit is exceeded (400)', async () => {
      vi.spyOn(messagingRepository, 'getLastHandler').mockResolvedValueOnce({
        staffUserId: staff1Id,
        departmentId: 'a0000000-0000-4000-8000-000000000010',
        startedAt: new Date(),
        endedAt: new Date(),
      });
      const limitErr = new Error('This request has reached the maximum allowed number of reopenings (2).');
      (limitErr as unknown as { code: string }).code = 'reopen_limit_exceeded';
      vi.spyOn(requestWorkflowRepository, 'reopenRequestByStaff').mockRejectedValueOnce(limitErr);

      const res = await request(app)
        .post(`/api/v1/staff/requests/${requestId}/reopen-closed`)
        .set('Authorization', `Bearer ${staff1Token}`)
        .send({ reason: 'Attempting reopen past limit' });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('maximum');
    });

    it('12. staff reopen fails if reopening time window has expired (400)', async () => {
      vi.spyOn(messagingRepository, 'getLastHandler').mockResolvedValueOnce({
        staffUserId: staff1Id,
        departmentId: 'a0000000-0000-4000-8000-000000000010',
        startedAt: new Date(),
        endedAt: new Date(),
      });
      const windowErr = new Error('The reopening time window of 7 days has expired. Request can no longer be reopened.');
      (windowErr as unknown as { code: string }).code = 'window_expired';
      vi.spyOn(requestWorkflowRepository, 'reopenRequestByStaff').mockRejectedValueOnce(windowErr);

      const res = await request(app)
        .post(`/api/v1/staff/requests/${requestId}/reopen-closed`)
        .set('Authorization', `Bearer ${staff1Token}`)
        .send({ reason: 'Reopen after window' });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('expired');
    });

    it('13. last handler staff can reject further action with an explanation', async () => {
      mockClientQuery.mockImplementation(async (sql: string) => {
        if (typeof sql === 'string' && sql.includes('FOR UPDATE')) {
          return {
            rows: [{ id: requestId, status: 'closed', deleted_at: null }],
          };
        }
        return { rows: [] };
      });
      vi.spyOn(messagingRepository, 'getLastHandler').mockResolvedValueOnce({
        staffUserId: staff1Id,
        departmentId: 'a0000000-0000-4000-8000-000000000010',
        startedAt: new Date(),
        endedAt: new Date(),
      });
      vi.spyOn(messagingRepository, 'insertComment').mockResolvedValueOnce({
        id: 'c0000000-0000-4000-8000-000000000003',
        requestId,
        authorId: staff1Id,
        authorName: 'Staff One',
        authorRole: 'staff',
        content: 'No further appeals are possible for this academic term.',
        visibility: 'student_visible',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const res = await request(app)
        .post(`/api/v1/staff/requests/${requestId}/reject-further`)
        .set('Authorization', `Bearer ${staff1Token}`)
        .send({ explanation: 'No further appeals are possible for this academic term.' });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');
      expect(res.body.data.message.content).toBe('No further appeals are possible for this academic term.');
    });

    it('14. rejecting further action requires a non-empty explanation (400)', async () => {
      const res = await request(app)
        .post(`/api/v1/staff/requests/${requestId}/reject-further`)
        .set('Authorization', `Bearer ${staff1Token}`)
        .send({ explanation: '   ' });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('cannot be blank');
    });
  });

  describe('Attachments & Download Authorisation', () => {
    const mockAttachment: AttachmentRecord = {
      id: attachmentId,
      requestId,
      commentId: null,
      uploadedBy: student1Id,
      originalName: 'evidence.pdf',
      storageBackend: 'local',
      storageKey: 'evidence-uuid.pdf',
      mimeType: 'application/pdf',
      fileSizeBytes: 2048,
      checksumSha256: null,
      createdAt: new Date(),
    };

    it('15. rejects disallowed file types during upload with 400', async () => {
      const res = await request(app)
        .post(`/api/v1/requests/${requestId}/messages/attachments`)
        .set('Authorization', `Bearer ${student1Token}`)
        .attach('file', Buffer.from('malicious payload'), {
          filename: 'payload.exe',
          contentType: 'application/x-msdownload',
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('not allowed');
    });

    it('15b. rejects spoofed MIME type with invalid magic bytes (e.g. text claiming to be PDF)', async () => {
      const res = await request(app)
        .post(`/api/v1/requests/${requestId}/messages/attachments`)
        .set('Authorization', `Bearer ${student1Token}`)
        .attach('file', Buffer.from('NOT A REAL PDF'), {
          filename: 'fake.pdf',
          contentType: 'application/pdf',
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('does not match claimed PDF format');
    });

    it('15c. rejects Windows PE executable even if disguised as allowed MIME', async () => {
      const mzBuffer = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);
      const res = await request(app)
        .post(`/api/v1/requests/${requestId}/messages/attachments`)
        .set('Authorization', `Bearer ${student1Token}`)
        .attach('file', mzBuffer, {
          filename: 'disguised.png',
          contentType: 'image/png',
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Executable files are strictly forbidden');
    });

    it('16. student owner can download authorized attachment', async () => {
      vi.spyOn(messagingRepository, 'findAttachmentById').mockResolvedValueOnce(mockAttachment);
      vi.spyOn(requestRepository, 'findById').mockResolvedValueOnce(mockClosedRequest);
      vi.spyOn(storageAdapter, 'getSignedUrl').mockResolvedValueOnce('https://storage.univoice.edu/evidence-uuid.pdf');

      const res = await request(app)
        .get(`/api/v1/attachments/${attachmentId}`)
        .set('Authorization', `Bearer ${student1Token}`);

      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('https://storage.univoice.edu/evidence-uuid.pdf');
    });

    it("17. unauthorized student cannot download another student's attachment (404)", async () => {
      vi.spyOn(messagingRepository, 'findAttachmentById').mockResolvedValueOnce(mockAttachment);
      vi.spyOn(requestRepository, 'findById').mockResolvedValueOnce(mockClosedRequest);

      const res = await request(app)
        .get(`/api/v1/attachments/${attachmentId}`)
        .set('Authorization', `Bearer ${student2Token}`);

      expect(res.status).toBe(404);
      expect(res.body.message).toContain('not found');
    });

    it('18. administrator can download attachment via audit access', async () => {
      vi.spyOn(messagingRepository, 'findAttachmentById').mockResolvedValueOnce(mockAttachment);
      vi.spyOn(storageAdapter, 'getSignedUrl').mockResolvedValueOnce('https://storage.univoice.edu/evidence-uuid.pdf');

      const res = await request(app)
        .get(`/api/v1/attachments/${attachmentId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('https://storage.univoice.edu/evidence-uuid.pdf');
    });

    it('19. cleans up stored file if database transaction fails during attachment upload', async () => {
      vi.spyOn(requestRepository, 'findById').mockResolvedValueOnce(mockClosedRequest);
      const deleteSpy = vi.spyOn(storageAdapter, 'delete').mockResolvedValueOnce();
      vi.spyOn(storageAdapter, 'store').mockResolvedValueOnce({
        storageKey: 'test-cleanup-key.pdf',
        backend: 'local',
      });
      vi.spyOn(messagingRepository, 'insertAttachment').mockRejectedValueOnce(
        new Error('Database transaction failed on insertAttachment'),
      );

      const validPdfBuffer = Buffer.from('%PDF-1.4 simulated pdf stream');
      const res = await request(app)
        .post(`/api/v1/requests/${requestId}/messages/attachments`)
        .set('Authorization', `Bearer ${student1Token}`)
        .attach('file', validPdfBuffer, {
          filename: 'valid.pdf',
          contentType: 'application/pdf',
        });

      expect(res.status).toBe(500);
      expect(deleteSpy).toHaveBeenCalledWith('test-cleanup-key.pdf', 'local');
    });

    it('20. staff cannot reopen a rejected request (rejection is final)', async () => {
      vi.spyOn(messagingRepository, 'getLastHandler').mockResolvedValueOnce({
        staffUserId: staff1Id,
        departmentId: 'a0000000-0000-4000-8000-000000000010',
        startedAt: new Date(),
        endedAt: new Date(),
      });
      const rejectErr = new Error('Rejected requests are final and cannot be reopened');
      (rejectErr as unknown as { code: string }).code = 'rejection_final';
      vi.spyOn(requestWorkflowRepository, 'reopenRequestByStaff').mockRejectedValueOnce(rejectErr);

      const res = await request(app)
        .post(`/api/v1/staff/requests/${requestId}/reopen-closed`)
        .set('Authorization', `Bearer ${staff1Token}`)
        .send({ reason: 'Attempt to reopen rejected request' });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('final');
    });

    it('21. getLastHandler correctly chooses previous handler who resolved request over an earlier returned handler', async () => {
      // Setup: Handler 1 claimed and returned. Handler 2 claimed and resolved.
      // getLastHandler query ordering: (ended_at IS NULL) DESC, COALESCE(ended_at, started_at) DESC
      // Handler 2 should be selected.
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            assignee_id: staff2Id,
            department_id: 'a0000000-0000-4000-8000-000000000010',
            started_at: new Date(Date.now() - 3600 * 1000),
            ended_at: new Date(Date.now() - 1800 * 1000), // Ended at resolution
          },
        ],
      });

      const handler = await messagingRepository.getLastHandler(requestId);
      expect(handler).not.toBeNull();
      expect(handler!.staffUserId).toBe(staff2Id);
    });
  });
});
