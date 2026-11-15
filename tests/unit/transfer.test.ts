import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../src/app';
import { signAccessToken } from '../../src/services/auth/token.service';
import { userRepository } from '../../src/repositories/user.repository';
import { transferRepository, RequestTransferRecord } from '../../src/repositories/transfer.repository';

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

describe('Permanent Transfer Endpoints (Phase 7 Milestone 3)', () => {
  // All IDs must be valid RFC 4122 UUIDs (hex only in first segment)
  const studentId      = 'a0000000-0000-4000-8000-000000000001';
  const staffLowId     = 'a0000000-0000-4000-8000-000000000011';
  const staffMidId     = 'a0000000-0000-4000-8000-000000000012';
  const staffApexId    = 'a0000000-0000-4000-8000-000000000013';
  const receivingStaffId = 'a0000000-0000-4000-8000-000000000021';
  const adminId        = 'a0000000-0000-4000-8000-000000000099';

  const dept1Id = 'd0000000-0000-4000-8000-000000000001'; // Finance
  const dept2Id = 'd0000000-0000-4000-8000-000000000002'; // Registrar

  const cat1Id = 'c0000000-0000-4000-8000-000000000001';
  const cat2Id = 'c0000000-0000-4000-8000-000000000002';

  // Authority level IDs — must use hex-only prefix ('b' = valid hex)
  const dept1L1Id = 'b0000000-0000-4000-8000-000000000001'; // Level 1 (lowest)
  const dept1L2Id = 'b0000000-0000-4000-8000-000000000002'; // Level 2 (middle)
  // dept1L3Id unused in tests but defined for completeness
  // const dept1L3Id = 'b0000000-0000-4000-8000-000000000003'; // Level 3 (apex)

  const dept2L1Id = 'b0000000-0000-4000-8000-000000000011'; // Level 1 (lowest, non-apex in dept2)
  const dept2L2Id = 'b0000000-0000-4000-8000-000000000012'; // Level 2 (apex of dept 2)

  const requestId    = 'e0000000-0000-4000-8000-000000000001';
  const assignmentId = 'f0000000-0000-4000-8000-000000000001';
  const transferId   = 'ab000000-0000-4000-8000-000000000001';

  let staffLowToken: string;
  let staffMidToken: string;
  let staffApexToken: string;
  let receivingStaffToken: string;
  let adminToken: string;

  /**
   * Raw DB row (snake_case) representing the request as returned by pg.
   * The service reads snake_case fields like deleted_at, responsible_department_id etc.
   */
  const mockDbRequestRow = {
    id: requestId,
    public_ref: 'REQ-2026-00001',
    title: 'Tuition Fee Waiver Inquiry',
    description: 'Requires interdepartmental review with Registrar.',
    student_id: studentId,
    category_id: cat1Id,
    initial_category_id: cat1Id,
    responsible_department_id: dept1Id,
    current_authority_level_id: dept1L2Id,
    current_assignment_id: assignmentId,
    current_escalation_id: null,
    priority: 'high',
    status: 'assigned',
    due_at: null,
    resolution_category: null,
    resolution_notes: null,
    resolved_at: null,
    closed_at: null,
    first_closed_at: null,
    rejected_at: null,
    rejection_reason: null,
    reopen_count: 0,
    last_reopen_reason: null,
    deleted_at: null,
    created_at: new Date(),
    updated_at: new Date(),
  };

  /**
   * Raw DB row (snake_case) for the transfer record as returned by pg.
   */
  const mockDbTransferRow = {
    id: transferId,
    request_id: requestId,
    sequence_no: 1,
    from_department_id: dept1Id,
    to_department_id: dept2Id,
    from_category_id: cat1Id,
    to_category_id: cat2Id,
    from_authority_level_id: dept1L2Id,
    to_authority_level_id: dept2L1Id,
    initiated_by: staffMidId,
    initiated_assignment_id: assignmentId,
    reason: 'Issue relates to academic records managed by Registrar.',
    status: 'pending',
    decided_by: null,
    decided_at: null,
    rejection_reason: null,
    cancellation_reason: null,
    cancelled_at: null,
    cancelled_by: null,
    created_at: new Date(),
    updated_at: new Date(),
  };

  /**
   * TypeScript-mapped transfer record (camelCase), used only for repository spy returns.
   */
  const sampleTransfer: RequestTransferRecord = {
    id: transferId,
    requestId,
    sequenceNo: 1,
    fromDepartmentId: dept1Id,
    toDepartmentId: dept2Id,
    fromCategoryId: cat1Id,
    toCategoryId: cat2Id,
    fromAuthorityLevelId: dept1L2Id,
    toAuthorityLevelId: dept2L1Id,
    initiatedBy: staffMidId,
    initiatedAssignmentId: assignmentId,
    reason: 'Issue relates to academic records managed by Registrar.',
    status: 'pending',
    decidedBy: null,
    decidedAt: null,
    rejectionReason: null,
    cancellationReason: null,
    cancelledAt: null,
    cancelledBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockClientQuery.mockResolvedValue({ rows: [] });
    mockQuery.mockResolvedValue({ rows: [] });

    staffLowToken      = signAccessToken({ sub: staffLowId,      email: 'staff-low@univoice.edu',   role: 'staff' });
    staffMidToken      = signAccessToken({ sub: staffMidId,      email: 'staff-mid@univoice.edu',   role: 'staff' });
    staffApexToken     = signAccessToken({ sub: staffApexId,     email: 'staff-apex@univoice.edu',  role: 'staff' });
    receivingStaffToken = signAccessToken({ sub: receivingStaffId, email: 'receiving@univoice.edu', role: 'staff' });
    adminToken         = signAccessToken({ sub: adminId,         email: 'admin@univoice.edu',       role: 'admin' });

    vi.spyOn(userRepository, 'findById').mockImplementation(async (id: string) => ({
      id,
      email: 'user@univoice.edu',
      role: id === adminId ? 'admin' : id === studentId ? 'student' : 'staff',
      isActive: true,
      firstName: 'Test',
      lastName: 'User',
      fullName: 'Test User',
      primaryDepartmentId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }));
  });

  // ---------------------------------------------------------------------------
  // 1. Transfer Initiation Authorization & Validation
  // ---------------------------------------------------------------------------
  describe('1. Transfer Initiation Authorization & Validation', () => {
    /**
     * Returns a mockClientQuery implementation for transfer initiation scenarios.
     * Callers provide:
     *  - targetLevelId / targetLevelOrder: the receiving authority level
     *  - initiatorAssigneeId: who the assignment is under
     *  - initiatorLevelOrder: caller's level_order in dept1
     *  - dept1MinOrder / dept1MaxOrder: dept1 tier bounds
     *  - dept2ApexOrder: highest active level_order in dept2
     */
    function makeInitiateMock(opts: {
      targetLevelId: string;
      targetLevelOrder: number;
      initiatorAssigneeId: string;
      initiatorLevelOrder: number;
      dept1MinOrder: number;
      dept1MaxOrder: number;
      dept2ApexOrder: number;
    }) {
      return async (sql: string) => {
        // 1. Lock request row
        if (sql.includes('SELECT id, status, responsible_department_id')) {
          return { rows: [{ ...mockDbRequestRow }] };
        }
        // 2. Pending transfer check
        if (sql.includes("status = 'pending'") && sql.includes('request_transfers')) {
          return { rows: [] };
        }
        // 3. Receiving department active check
        if (sql.includes('SELECT id, is_active FROM departments')) {
          return { rows: [{ id: dept2Id, is_active: true }] };
        }
        // 4. Receiving category check
        if (sql.includes('SELECT id, is_active, department_id FROM categories')) {
          return { rows: [{ id: cat2Id, is_active: true, department_id: dept2Id }] };
        }
        // 5. Receiving authority level check
        if (sql.includes('SELECT id, level_order, is_active, department_id FROM department_authority_levels')) {
          return { rows: [{ id: opts.targetLevelId, level_order: opts.targetLevelOrder, is_active: true, department_id: dept2Id }] };
        }
        // 6a. Apex of receiving dept — only MAX, no MIN
        if (sql.includes('MAX(level_order) AS max_order') && !sql.includes('MIN(level_order)')) {
          return { rows: [{ max_order: opts.dept2ApexOrder }] };
        }
        // 7a. Assignee check
        if (sql.includes('SELECT assignee_id FROM request_assignments')) {
          return { rows: [{ assignee_id: opts.initiatorAssigneeId }] };
        }
        // 7b. Initiator's level in dept1
        if (sql.includes('FROM staff_department_authority_levels')) {
          return { rows: [{ level_order: opts.initiatorLevelOrder }] };
        }
        // 6b. Min/max of initiator's dept (has both MIN and MAX)
        if (sql.includes('MIN(level_order) AS min_order') && sql.includes('MAX(level_order) AS max_order')) {
          return { rows: [{ min_order: opts.dept1MinOrder, max_order: opts.dept1MaxOrder }] };
        }
        // Sequence number for INSERT — seq query
        if (sql.includes('COALESCE(MAX(sequence_no)')) {
          return { rows: [{ seq: 1 }] };
        }
        return { rows: [] };
      };
    }

    it('lowest-tier staff cannot initiate transfers (403 Forbidden)', async () => {
      mockClientQuery.mockImplementation(makeInitiateMock({
        targetLevelId: dept2L1Id,
        targetLevelOrder: 1,
        initiatorAssigneeId: staffLowId,
        initiatorLevelOrder: 1,  // Lowest (equals min=1)
        dept1MinOrder: 1,
        dept1MaxOrder: 3,
        dept2ApexOrder: 2,
      }));

      const res = await request(app)
        .post(`/api/v1/staff/requests/${requestId}/transfers`)
        .set('Authorization', `Bearer ${staffLowToken}`)
        .send({
          toDepartmentId: dept2Id,
          toCategoryId: cat2Id,
          toAuthorityLevelId: dept2L1Id,
          reason: 'Transfers require higher authority',
        });

      expect(res.status).toBe(403);
      expect(res.body.message).toContain('Lowest-authority staff cannot initiate transfers');
    });

    it('middle-tier staff cannot exceed authority ceiling by targeting receiving department apex tier (400 Bad Request)', async () => {
      mockClientQuery.mockImplementation(makeInitiateMock({
        targetLevelId: dept2L2Id,  // Apex of dept2
        targetLevelOrder: 2,        // === dept2ApexOrder → ceiling exceeded
        initiatorAssigneeId: staffMidId,
        initiatorLevelOrder: 2,     // Middle in dept1 (min=1, max=3)
        dept1MinOrder: 1,
        dept1MaxOrder: 3,
        dept2ApexOrder: 2,          // Receiving dept apex
      }));

      const res = await request(app)
        .post(`/api/v1/staff/requests/${requestId}/transfers`)
        .set('Authorization', `Bearer ${staffMidToken}`)
        .send({
          toDepartmentId: dept2Id,
          toCategoryId: cat2Id,
          toAuthorityLevelId: dept2L2Id,
          reason: 'Trying to escalate directly to director',
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Authority ceiling exceeded');
    });

    it('middle-tier staff can initiate transfer to non-apex receiving level', async () => {
      mockClientQuery.mockImplementation(makeInitiateMock({
        targetLevelId: dept2L1Id,  // Non-apex of dept2
        targetLevelOrder: 1,        // < dept2ApexOrder (2) → allowed
        initiatorAssigneeId: staffMidId,
        initiatorLevelOrder: 2,     // Middle in dept1
        dept1MinOrder: 1,
        dept1MaxOrder: 3,
        dept2ApexOrder: 2,
      }));
      vi.spyOn(transferRepository, 'insertTransfer').mockResolvedValueOnce(sampleTransfer);

      const res = await request(app)
        .post(`/api/v1/staff/requests/${requestId}/transfers`)
        .set('Authorization', `Bearer ${staffMidToken}`)
        .send({
          toDepartmentId: dept2Id,
          toCategoryId: cat2Id,
          toAuthorityLevelId: dept2L1Id,
          reason: 'Academic dispute properly belongs with Registrar.',
        });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('success');
      expect(res.body.data.transfer.status).toBe('pending');
    });

    it('apex-tier staff can initiate transfer targeting apex level of receiving department', async () => {
      mockClientQuery.mockImplementation(makeInitiateMock({
        targetLevelId: dept2L2Id,  // Apex of dept2
        targetLevelOrder: 2,        // === dept2ApexOrder
        initiatorAssigneeId: staffApexId,
        initiatorLevelOrder: 3,     // Apex in dept1 (equals max=3) → highest tier
        dept1MinOrder: 1,
        dept1MaxOrder: 3,
        dept2ApexOrder: 2,
      }));
      vi.spyOn(transferRepository, 'insertTransfer').mockResolvedValueOnce({
        ...sampleTransfer,
        toAuthorityLevelId: dept2L2Id,
      });

      const res = await request(app)
        .post(`/api/v1/staff/requests/${requestId}/transfers`)
        .set('Authorization', `Bearer ${staffApexToken}`)
        .send({
          toDepartmentId: dept2Id,
          toCategoryId: cat2Id,
          toAuthorityLevelId: dept2L2Id,
          reason: 'Head-to-head executive transfer.',
        });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('success');
    });

    it('rejects initiating duplicate pending transfer with 409 Conflict', async () => {
      mockClientQuery.mockImplementation(async (sql: string) => {
        if (sql.includes('SELECT id, status, responsible_department_id')) {
          return { rows: [{ ...mockDbRequestRow }] };
        }
        if (sql.includes('SELECT id FROM request_transfers') && sql.includes("status = 'pending'")) {
          return { rows: [{ id: transferId }] }; // Already pending!
        }
        return { rows: [] };
      });

      const res = await request(app)
        .post(`/api/v1/staff/requests/${requestId}/transfers`)
        .set('Authorization', `Bearer ${staffMidToken}`)
        .send({
          toDepartmentId: dept2Id,
          toCategoryId: cat2Id,
          toAuthorityLevelId: dept2L1Id,
          reason: 'Trying to open a second transfer',
        });

      expect(res.status).toBe(409);
      expect(res.body.message).toContain('already pending');
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Transfer Acceptance & Rejection Decisions
  // ---------------------------------------------------------------------------
  describe('2. Transfer Acceptance & Rejection Decisions', () => {
    it('authorized receiving staff can accept incoming transfer', async () => {
      const queryOrder: string[] = [];
      mockClientQuery.mockImplementation(async (sql: string) => {
        queryOrder.push(sql);
        if (sql.includes('SELECT request_id FROM request_transfers WHERE id = $1')) {
          return { rows: [{ request_id: requestId }] };
        }
        if (sql.includes('SELECT * FROM request_transfers WHERE id = $1 FOR UPDATE')) {
          return { rows: [{ ...mockDbTransferRow }] };
        }
        if (sql.includes('SELECT id, status, responsible_department_id')) {
          return { rows: [{ ...mockDbRequestRow }] };
        }
        if (sql.includes('SELECT 1 FROM staff_department_memberships')) {
          return { rows: [{ '?column?': 1 }] };
        }
        if (sql.includes('SELECT level_order FROM department_authority_levels WHERE id = $1')) {
          return { rows: [{ level_order: 1 }] };
        }
        if (sql.includes('FROM staff_department_authority_levels')) {
          return { rows: [{ level_order: 2 }] }; // Level 2 >= target Level 1
        }
        if (sql.includes('SELECT 1 FROM staff_category_authorizations')) {
          return { rows: [{ '?column?': 1 }] };
        }
        return { rows: [] };
      });
      vi.spyOn(transferRepository, 'findById').mockResolvedValueOnce({
        ...sampleTransfer,
        status: 'accepted',
        decidedBy: receivingStaffId,
        decidedAt: new Date(),
      });

      const res = await request(app)
        .post(`/api/v1/staff/transfers/${transferId}/accept`)
        .set('Authorization', `Bearer ${receivingStaffToken}`);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');
      expect(res.body.data.transfer.status).toBe('accepted');
      const parentLockIndex = queryOrder.findIndex((sql) =>
        sql.includes('FROM requests') && sql.includes('FOR UPDATE'),
      );
      const transferLockIndex = queryOrder.findIndex((sql) =>
        sql.includes('FROM request_transfers') && sql.includes('FOR UPDATE'),
      );
      expect(parentLockIndex).toBeGreaterThan(-1);
      expect(transferLockIndex).toBeGreaterThan(parentLockIndex);
    });

    /**
     * Administrators are allowed through the route-level requireRole('staff', 'admin')
     * on the transferRouter (now mounted before staffQueueRouter). The service itself
     * then rejects the admin with 403 and a specific message.
     */
    it('administrators cannot directly accept transfers on behalf of receiving staff (403 Forbidden)', async () => {
      mockClientQuery.mockImplementation(async (sql: string) => {
        if (sql.includes('SELECT request_id FROM request_transfers WHERE id = $1')) {
          return { rows: [{ request_id: requestId }] };
        }
        if (sql.includes('SELECT * FROM request_transfers WHERE id = $1 FOR UPDATE')) {
          return { rows: [{ ...mockDbTransferRow }] };
        }
        if (sql.includes('SELECT id, status, responsible_department_id')) {
          return { rows: [{ ...mockDbRequestRow }] };
        }
        return { rows: [] };
      });

      const res = await request(app)
        .post(`/api/v1/staff/transfers/${transferId}/accept`)
        .set('Authorization', `Bearer ${adminToken}`);

      // Service explicitly rejects admins with a domain-specific 403 message
      expect(res.status).toBe(403);
      expect(res.body.message).toContain('Administrators cannot directly accept transfers');
    });

    it('authorized receiving staff can reject incoming transfer with mandatory reason', async () => {
      mockClientQuery.mockImplementation(async (sql: string) => {
        if (sql.includes('SELECT request_id FROM request_transfers WHERE id = $1')) {
          return { rows: [{ request_id: requestId }] };
        }
        if (sql.includes('SELECT * FROM request_transfers WHERE id = $1 FOR UPDATE')) {
          return { rows: [{ ...mockDbTransferRow }] };
        }
        if (sql.includes('SELECT id, status, responsible_department_id')) {
          return { rows: [{ ...mockDbRequestRow }] };
        }
        if (sql.includes('SELECT 1 FROM staff_department_memberships')) {
          return { rows: [{ '?column?': 1 }] };
        }
        return { rows: [] };
      });
      vi.spyOn(transferRepository, 'findById').mockResolvedValueOnce({
        ...sampleTransfer,
        status: 'rejected',
        rejectionReason: 'Fee appeals must remain with Student Finance.',
        decidedBy: receivingStaffId,
        decidedAt: new Date(),
      });

      const res = await request(app)
        .post(`/api/v1/staff/transfers/${transferId}/reject`)
        .set('Authorization', `Bearer ${receivingStaffToken}`)
        .send({
          rejectionReason: 'Fee appeals must remain with Student Finance.',
        });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');
      expect(res.body.data.transfer.status).toBe('rejected');
    });

    it('rejecting a transfer without a reason fails with 400 Bad Request', async () => {
      const res = await request(app)
        .post(`/api/v1/staff/transfers/${transferId}/reject`)
        .set('Authorization', `Bearer ${receivingStaffToken}`)
        .send({
          rejectionReason: '   ',
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Rejection reason is required');
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Transfer Invalidation Safety & Querying
  // ---------------------------------------------------------------------------
  describe('3. Transfer Invalidation Safety & Querying', () => {
    it('returns 409 Conflict if request was returned or escalated while transfer was pending', async () => {
      mockClientQuery.mockImplementation(async (sql: string) => {
        if (sql.includes('SELECT request_id FROM request_transfers WHERE id = $1')) {
          return { rows: [{ request_id: requestId }] };
        }
        if (sql.includes('SELECT * FROM request_transfers WHERE id = $1 FOR UPDATE')) {
          return { rows: [{ ...mockDbTransferRow }] };
        }
        if (sql.includes('SELECT id, status, responsible_department_id')) {
          // Status changed to pending (e.g. handler returned it) — no longer assignable
          return { rows: [{ ...mockDbRequestRow, status: 'pending', current_assignment_id: null }] };
        }
        return { rows: [] };
      });

      const res = await request(app)
        .post(`/api/v1/staff/transfers/${transferId}/accept`)
        .set('Authorization', `Bearer ${receivingStaffToken}`);

      expect(res.status).toBe(409);
      expect(res.body.message).toContain('no longer eligible for transfer');
    });

    it('staff can retrieve pending transfers for their department', async () => {
      mockQuery.mockImplementation(async (sql: string) => {
        if (sql.includes('SELECT department_id FROM staff_department_memberships')) {
          return { rows: [{ department_id: dept2Id }] };
        }
        return { rows: [] };
      });
      vi.spyOn(transferRepository, 'findPendingTransfers').mockResolvedValueOnce({
        transfers: [sampleTransfer],
        total: 1,
      });

      const res = await request(app)
        .get('/api/v1/staff/transfers/pending')
        .set('Authorization', `Bearer ${receivingStaffToken}`);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');
      expect(res.body.data.transfers).toHaveLength(1);
    });

    it('admin can monitor transfers across all departments', async () => {
      vi.spyOn(transferRepository, 'findPendingTransfers').mockResolvedValueOnce({
        transfers: [sampleTransfer],
        total: 1,
      });

      const res = await request(app)
        .get('/api/v1/admin/transfers')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');
      expect(res.body.data.transfers).toHaveLength(1);
    });
  });
});
