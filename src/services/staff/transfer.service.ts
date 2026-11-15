import { PoolClient } from 'pg';
import { pool } from '../../config/db';
import { AppError } from '../../utils/AppError';
import { requestRepository, RequestRecord } from '../../repositories/request.repository';
import { transferRepository, RequestTransferRecord } from '../../repositories/transfer.repository';
import {
  InitiateTransferInput,
  RejectTransferInput,
  TransferQueryInput,
} from '../../validators/transfer.validators';

export class TransferService {
  /**
   * Initiates a permanent transfer of a request to another department.
   * Business rules:
   * 1. Initiator must be a middle- or highest-authority staff member of the current responsible department,
   *    or an administrator. Lowest-tier staff cannot initiate transfers.
   * 2. Request must be in 'assigned' or 'in_progress' status.
   * 3. Receiving department must be active and distinct from current department.
   * 4. Receiving category must belong to receiving department and be active.
   * 5. Receiving authority level must belong to receiving department and be active.
   * 6. Three-tier authority ceiling:
   *    - Middle-tier staff cannot target receiving department's apex (highest) authority level.
   *    - Apex staff and administrators can target any active receiving level.
   * 7. A non-empty reason is mandatory.
   * 8. Request remains owned by original department; handler remains assigned; capacity remains occupied.
   * 9. At most one pending transfer per request at any time.
   */
  async initiateTransfer(
    callerId: string,
    callerRole: string,
    requestId: string,
    input: InitiateTransferInput,
  ): Promise<RequestTransferRecord> {
    const client: PoolClient = await pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Lock the request row
      const reqRes = await client.query(
        `SELECT id, status, responsible_department_id, category_id, current_authority_level_id,
                current_assignment_id, deleted_at
         FROM requests
         WHERE id = $1
         FOR UPDATE;`,
        [requestId],
      );

      if (reqRes.rows.length === 0 || reqRes.rows[0].deleted_at !== null) {
        throw new AppError(`Request ${requestId} not found`, 404);
      }

      const req = reqRes.rows[0];

      // 2. Request status validation
      if (req.status !== 'assigned' && req.status !== 'in_progress') {
        throw new AppError(
          `Only actively handled requests ('assigned' or 'in_progress') can be transferred (current status: '${req.status}')`,
          400,
        );
      }

      if (!req.current_assignment_id) {
        throw new AppError(`Request ${requestId} has no active assignment`, 400);
      }

      // Check for an existing pending transfer
      const pendingCheck = await client.query(
        `SELECT id FROM request_transfers WHERE request_id = $1 AND status = 'pending';`,
        [requestId],
      );
      if (pendingCheck.rows.length > 0) {
        throw new AppError(
          'A transfer request is already pending for this request. Multiple concurrent pending transfers are not permitted.',
          409,
        );
      }

      // 3. Receiving department must be different
      if (input.toDepartmentId === req.responsible_department_id) {
        throw new AppError('Receiving department must be different from current responsible department', 400);
      }

      // 4. Validate receiving department is active
      const toDeptRes = await client.query(
        `SELECT id, is_active FROM departments WHERE id = $1;`,
        [input.toDepartmentId],
      );
      if (toDeptRes.rows.length === 0) {
        throw new AppError('Receiving department not found', 404);
      }
      if (!toDeptRes.rows[0].is_active) {
        throw new AppError('Receiving department is inactive and cannot accept transfers', 400);
      }

      // 5. Validate receiving category belongs to receiving department and is active
      const toCatRes = await client.query(
        `SELECT id, is_active, department_id FROM categories WHERE id = $1;`,
        [input.toCategoryId],
      );
      if (toCatRes.rows.length === 0) {
        throw new AppError('Receiving category not found', 404);
      }
      if (toCatRes.rows[0].department_id !== input.toDepartmentId) {
        throw new AppError('Selected category does not belong to the receiving department', 400);
      }
      if (!toCatRes.rows[0].is_active) {
        throw new AppError('Selected receiving category is currently inactive', 400);
      }

      // 6. Validate receiving authority level belongs to receiving department and is active
      const toAuthRes = await client.query(
        `SELECT id, level_order, is_active, department_id FROM department_authority_levels WHERE id = $1;`,
        [input.toAuthorityLevelId],
      );
      if (toAuthRes.rows.length === 0) {
        throw new AppError('Receiving authority level not found', 404);
      }
      if (toAuthRes.rows[0].department_id !== input.toDepartmentId) {
        throw new AppError('Selected authority level does not belong to the receiving department', 400);
      }
      if (!toAuthRes.rows[0].is_active) {
        throw new AppError('Selected receiving authority level is currently inactive', 400);
      }
      const toLevelOrder = Number(toAuthRes.rows[0].level_order);

      // Determine apex level in receiving department
      const toApexRes = await client.query(
        `SELECT MAX(level_order) AS max_order FROM department_authority_levels WHERE department_id = $1 AND is_active = TRUE;`,
        [input.toDepartmentId],
      );
      const toApexOrder = Number(toApexRes.rows[0].max_order);

      // 7. Verify initiator tier and authority ceiling
      let initiatorTier: 'lowest' | 'middle' | 'highest' = 'lowest';

      if (callerRole === 'admin') {
        initiatorTier = 'highest';
      } else {
        // Must be the assigned staff member
        const assignRes = await client.query(
          `SELECT assignee_id FROM request_assignments WHERE id = $1 AND ended_at IS NULL;`,
          [req.current_assignment_id],
        );
        if (assignRes.rows.length === 0 || assignRes.rows[0].assignee_id !== callerId) {
          throw new AppError('Only the currently assigned staff member can initiate a transfer for this request', 403);
        }

        // Fetch initiator's active authority level in current department
        const authRes = await client.query(
          `SELECT dal.level_order
           FROM staff_department_authority_levels sdal
           JOIN department_authority_levels dal ON dal.id = sdal.department_authority_level_id
           WHERE sdal.staff_user_id = $1
             AND sdal.department_id = $2
             AND (sdal.valid_to IS NULL OR sdal.valid_to > NOW());`,
          [callerId, req.responsible_department_id],
        );

        if (authRes.rows.length === 0) {
          throw new AppError('Staff member has no active authority level in current responsible department', 403);
        }
        const initiatorLevelOrder = Number(authRes.rows[0].level_order);

        // Fetch all active levels in current department
        const deptLevelsRes = await client.query(
          `SELECT MIN(level_order) AS min_order, MAX(level_order) AS max_order
           FROM department_authority_levels
           WHERE department_id = $1 AND is_active = TRUE;`,
          [req.responsible_department_id],
        );
        const minOrder = Number(deptLevelsRes.rows[0].min_order);
        const maxOrder = Number(deptLevelsRes.rows[0].max_order);

        if (initiatorLevelOrder === minOrder) {
          initiatorTier = 'lowest';
        } else if (initiatorLevelOrder === maxOrder) {
          initiatorTier = 'highest';
        } else {
          initiatorTier = 'middle';
        }
      }

      // Lowest tier cannot initiate
      if (initiatorTier === 'lowest') {
        throw new AppError(
          'Lowest-authority staff cannot initiate transfers. Only middle- or highest-authority staff may transfer requests.',
          403,
        );
      }

      // Middle tier cannot target apex level
      if (initiatorTier === 'middle' && toLevelOrder >= toApexOrder) {
        throw new AppError(
          `Authority ceiling exceeded: Middle-authority staff cannot transfer directly to the receiving department's highest authority level (Level ${toApexOrder}).`,
          400,
        );
      }

      // 8. Insert transfer record
      const transfer = await transferRepository.insertTransfer(
        {
          requestId,
          fromDepartmentId: req.responsible_department_id,
          toDepartmentId: input.toDepartmentId,
          fromCategoryId: req.category_id,
          toCategoryId: input.toCategoryId,
          fromAuthorityLevelId: req.current_authority_level_id,
          toAuthorityLevelId: input.toAuthorityLevelId,
          initiatedBy: callerId,
          initiatedAssignmentId: req.current_assignment_id,
          reason: input.reason,
        },
        client,
      );

      // 9. Record business event in request_history
      await client.query(
        `INSERT INTO request_history (
           request_id, actor_id, action, field_name, old_value, new_value, details
         ) VALUES (
           $1, $2, 'transfer_initiated', 'status', $3, $3,
           jsonb_build_object(
             'transfer_id', $4::text,
             'from_department_id', $5::text,
             'to_department_id', $6::text,
             'to_category_id', $7::text,
             'to_authority_level_id', $8::text,
             'reason', $9
           )
         );`,
        [
          requestId,
          callerId,
          req.status,
          transfer.id,
          req.responsible_department_id,
          input.toDepartmentId,
          input.toCategoryId,
          input.toAuthorityLevelId,
          input.reason,
        ],
      );

      await client.query('COMMIT');
      return transfer;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Accepts a pending transfer.
   * Business rules:
   * 1. Caller must be an authorized receiving-department staff member.
   *    (Holds active membership, active authority level >= target level, and can_handle = TRUE for target category).
   * 2. Request and transfer row-locked.
   * 3. Request must still be in 'assigned' or 'in_progress' status in the originating department.
   * 4. Ends original handler assignment (releases capacity).
   * 5. Atomically transitions request:
   *    - responsible_department_id -> toDepartmentId
   *    - category_id -> toCategoryId
   *    - current_authority_level_id -> toAuthorityLevelId
   *    - current_assignment_id -> NULL
   *    - status -> 'pending'
   *    - initial_category_id remains UNCHANGED (immutable original student classification).
   * 6. Marks transfer as 'accepted'.
   * 7. Records transfer_accepted event in request_history.
   */
  async acceptTransfer(
    callerId: string,
    callerRole: string,
    transferId: string,
  ): Promise<RequestTransferRecord> {
    const client: PoolClient = await pool.connect();
    try {
      await client.query('BEGIN');

      // Read the immutable request_id without locking the transfer. Parent-first
      // locking is required because parent lifecycle triggers may cancel transfers.
      const transferRefRes = await client.query(
        `SELECT request_id FROM request_transfers WHERE id = $1;`,
        [transferId],
      );

      if (transferRefRes.rows.length === 0) {
        throw new AppError(`Transfer ${transferId} not found`, 404);
      }

      const reqRes = await client.query(
        `SELECT id, status, responsible_department_id, category_id, current_assignment_id, deleted_at
         FROM requests
         WHERE id = $1
         FOR UPDATE;`,
        [transferRefRes.rows[0].request_id],
      );

      if (reqRes.rows.length === 0 || reqRes.rows[0].deleted_at !== null) {
        throw new AppError(`Request ${transferRefRes.rows[0].request_id} not found`, 404);
      }

      const transferRes = await client.query(
        `SELECT * FROM request_transfers WHERE id = $1 FOR UPDATE;`,
        [transferId],
      );

      if (transferRes.rows.length === 0) {
        throw new AppError(`Transfer ${transferId} not found`, 404);
      }

      const transfer = transferRes.rows[0];

      if (transfer.status !== 'pending') {
        throw new AppError(
          `Transfer cannot be accepted because it is already '${transfer.status}'`,
          409,
        );
      }

      const req = reqRes.rows[0];

      // Request must still be in originating department and active status
      if (
        req.responsible_department_id !== transfer.from_department_id ||
        (req.status !== 'assigned' && req.status !== 'in_progress')
      ) {
        throw new AppError(
          `Request is no longer eligible for transfer (current status: '${req.status}', department: '${req.responsible_department_id}')`,
          409,
        );
      }

      // 3. Authorize receiving staff (Administrators do NOT bypass receiving staff acceptance)
      if (callerRole === 'admin') {
        throw new AppError(
          'Administrators cannot directly accept transfers on behalf of receiving departments. Acceptance must be performed by authorized receiving department staff.',
          403,
        );
      }

      // Verify active membership in receiving department
      const memberRes = await client.query(
        `SELECT 1 FROM staff_department_memberships
         WHERE staff_user_id = $1
           AND department_id = $2
           AND (valid_to IS NULL OR valid_to > NOW());`,
        [callerId, transfer.to_department_id],
      );
      if (memberRes.rows.length === 0) {
        throw new AppError('Only active staff of the receiving department can accept this transfer', 403);
      }

      // Verify authority level in receiving department >= target level
      const toLevelRes = await client.query(
        `SELECT level_order FROM department_authority_levels WHERE id = $1;`,
        [transfer.to_authority_level_id],
      );
      const targetLevelOrder = Number(toLevelRes.rows[0]?.level_order ?? 1);

      const staffAuthRes = await client.query(
        `SELECT dal.level_order
         FROM staff_department_authority_levels sdal
         JOIN department_authority_levels dal ON dal.id = sdal.department_authority_level_id
         WHERE sdal.staff_user_id = $1
           AND sdal.department_id = $2
           AND (sdal.valid_to IS NULL OR sdal.valid_to > NOW());`,
        [callerId, transfer.to_department_id],
      );
      if (staffAuthRes.rows.length === 0 || Number(staffAuthRes.rows[0].level_order) < targetLevelOrder) {
        throw new AppError('Insufficient authority in receiving department to accept this transfer', 403);
      }

      // Verify category authorization for target category
      const catAuthRes = await client.query(
        `SELECT 1 FROM staff_category_authorizations
         WHERE staff_user_id = $1
           AND category_id = $2
           AND can_handle = TRUE
           AND (valid_to IS NULL OR valid_to > NOW());`,
        [callerId, transfer.to_category_id],
      );
      if (catAuthRes.rows.length === 0) {
        throw new AppError('Staff member is not authorized to handle the target category in the receiving department', 403);
      }

      // 4. Terminate active assignment to release original handler capacity
      if (req.current_assignment_id) {
        await client.query(
          `UPDATE request_assignments
           SET ended_at = NOW()
           WHERE id = $1 AND ended_at IS NULL;`,
          [req.current_assignment_id],
        );
      }

      // 5. Update request ownership and re-queue in receiving department
      await client.query(
        `UPDATE requests
         SET responsible_department_id = $1,
             category_id = $2,
             current_authority_level_id = $3,
             current_assignment_id = NULL,
             status = 'pending',
             updated_by = $4,
             updated_at = NOW()
         WHERE id = $5;`,
        [
          transfer.to_department_id,
          transfer.to_category_id,
          transfer.to_authority_level_id,
          callerId,
          req.id,
        ],
      );

      // 6. Update transfer record status
      await client.query(
        `UPDATE request_transfers
         SET status = 'accepted',
             decided_by = $1,
             decided_at = NOW(),
             updated_at = NOW()
         WHERE id = $2;`,
        [callerId, transferId],
      );

      // 7. Record high-level transfer_accepted event in request_history
      await client.query(
        `INSERT INTO request_history (
           request_id, actor_id, action, field_name, old_value, new_value, details
         ) VALUES (
           $1, $2, 'transfer_accepted', 'responsible_department_id', $3, $4,
           jsonb_build_object(
             'transfer_id', $5::text,
             'from_department_id', $3::text,
             'to_department_id', $4::text,
             'to_category_id', $6::text,
             'to_authority_level_id', $7::text,
             'released_assignment_id', $8::text
           )
         );`,
        [
          req.id,
          callerId,
          transfer.from_department_id,
          transfer.to_department_id,
          transferId,
          transfer.to_category_id,
          transfer.to_authority_level_id,
          req.current_assignment_id,
        ],
      );

      await client.query('COMMIT');

      const updated = await transferRepository.findById(transferId);
      return updated!;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Rejects a pending transfer.
   * Business rules:
   * 1. Requires mandatory non-empty rejection reason.
   * 2. Caller must be an active member of receiving department with required authority.
   * 3. Original department retains ownership; handler remains assigned; capacity remains occupied.
   * 4. Transfer status set to 'rejected'; recorded in history.
   */
  async rejectTransfer(
    callerId: string,
    callerRole: string,
    transferId: string,
    input: RejectTransferInput,
  ): Promise<RequestTransferRecord> {
    const client: PoolClient = await pool.connect();
    try {
      await client.query('BEGIN');

      // Resolve the immutable parent id first, then lock parent before transfer.
      // This matches parent disruption workflows and avoids a lock inversion.
      const transferRefRes = await client.query(
        `SELECT request_id FROM request_transfers WHERE id = $1;`,
        [transferId],
      );

      if (transferRefRes.rows.length === 0) {
        throw new AppError(`Transfer ${transferId} not found`, 404);
      }

      const reqRes = await client.query(
        `SELECT id, status, responsible_department_id, deleted_at
         FROM requests
         WHERE id = $1
         FOR UPDATE;`,
        [transferRefRes.rows[0].request_id],
      );

      if (reqRes.rows.length === 0 || reqRes.rows[0].deleted_at !== null) {
        throw new AppError(`Request ${transferRefRes.rows[0].request_id} not found`, 404);
      }

      const transferRes = await client.query(
        `SELECT * FROM request_transfers WHERE id = $1 FOR UPDATE;`,
        [transferId],
      );

      if (transferRes.rows.length === 0) {
        throw new AppError(`Transfer ${transferId} not found`, 404);
      }

      const transfer = transferRes.rows[0];

      if (transfer.status !== 'pending') {
        throw new AppError(
          `Transfer cannot be rejected because it is already '${transfer.status}'`,
          409,
        );
      }

      const req = reqRes.rows[0];
      if (
        req.responsible_department_id !== transfer.from_department_id ||
        (req.status !== 'assigned' && req.status !== 'in_progress')
      ) {
        throw new AppError(
          `Request is no longer eligible for transfer (current status: '${req.status}', department: '${req.responsible_department_id}')`,
          409,
        );
      }

      // 3. Authorize receiving staff
      if (callerRole === 'admin') {
        throw new AppError(
          'Administrators cannot directly reject transfers on behalf of receiving departments. Rejection must be performed by receiving department staff.',
          403,
        );
      }

      const memberRes = await client.query(
        `SELECT 1 FROM staff_department_memberships
         WHERE staff_user_id = $1
           AND department_id = $2
           AND (valid_to IS NULL OR valid_to > NOW());`,
        [callerId, transfer.to_department_id],
      );
      if (memberRes.rows.length === 0) {
        throw new AppError('Only active staff of the receiving department can reject this transfer', 403);
      }

      // 4. Update transfer row to rejected
      await client.query(
        `UPDATE request_transfers
         SET status = 'rejected',
             rejection_reason = $1,
             decided_by = $2,
             decided_at = NOW(),
             updated_at = NOW()
         WHERE id = $3;`,
        [input.rejectionReason, callerId, transferId],
      );

      // 5. Record rejection event in request_history
      await client.query(
        `INSERT INTO request_history (
           request_id, actor_id, action, field_name, old_value, new_value, details
         ) VALUES (
           $1, $2, 'transfer_rejected', 'status', $3, $3,
           jsonb_build_object(
             'transfer_id', $4::text,
             'from_department_id', $5::text,
             'to_department_id', $6::text,
             'rejection_reason', $7
           )
         );`,
        [
          transfer.request_id,
          callerId,
          req.status,
          transferId,
          transfer.from_department_id,
          transfer.to_department_id,
          input.rejectionReason,
        ],
      );

      await client.query('COMMIT');

      const updated = await transferRepository.findById(transferId);
      return updated!;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Retrieves transfer history for a specific request.
   */
  async getRequestTransfers(
    callerId: string,
    callerRole: string,
    requestId: string,
  ): Promise<RequestTransferRecord[]> {
    // Check request exists
    const req = await requestRepository.findById(requestId);
    if (!req) {
      throw new AppError(`Request ${requestId} not found`, 404);
    }

    // Role-based visibility:
    // Admin: can view all
    // Staff: can view if member of current or past handling department
    if (callerRole !== 'admin') {
      const db = pool;
      const staffDepts = await db.query(
        `SELECT department_id FROM staff_department_memberships WHERE staff_user_id = $1 AND (valid_to IS NULL OR valid_to > NOW());`,
        [callerId],
      );
      const callerDeptIds = new Set(staffDepts.rows.map((r) => r.department_id));

      if (!callerDeptIds.has(req.responsibleDepartmentId)) {
        // Also allow if caller was past assignee
        const assignCheck = await db.query(
          `SELECT 1 FROM request_assignments WHERE request_id = $1 AND assignee_id = $2;`,
          [requestId, callerId],
        );
        if (assignCheck.rows.length === 0) {
          throw new AppError('Access forbidden: insufficient department permissions to view transfer history', 403);
        }
      }
    }

    return transferRepository.findByRequestId(requestId);
  }

  /**
   * Retrieves pending transfers awaiting decision for caller's department (staff) or any department (admin).
   */
  async getPendingTransfers(
    callerId: string,
    callerRole: string,
    query: TransferQueryInput,
  ): Promise<{ transfers: RequestTransferRecord[]; total: number; page: number; limit: number; totalPages: number }> {
    let targetDeptId: string | undefined = query.departmentId;

    if (callerRole !== 'admin') {
      // Must be staff member's department
      const staffDepts = await pool.query(
        `SELECT department_id FROM staff_department_memberships WHERE staff_user_id = $1 AND (valid_to IS NULL OR valid_to > NOW());`,
        [callerId],
      );
      if (staffDepts.rows.length === 0) {
        return { transfers: [], total: 0, page: query.page, limit: query.limit, totalPages: 1 };
      }

      if (targetDeptId) {
        const hasAccess = staffDepts.rows.some((r) => r.department_id === targetDeptId);
        if (!hasAccess) {
          throw new AppError('Access forbidden: you are not a member of the requested department', 403);
        }
      } else {
        targetDeptId = staffDepts.rows[0].department_id;
      }
    }

    const { transfers, total } = await transferRepository.findPendingTransfers({
      toDepartmentId: targetDeptId,
      page: query.page,
      limit: query.limit,
    });

    const totalPages = Math.ceil(total / query.limit) || 1;
    return { transfers, total, page: query.page, limit: query.limit, totalPages };
  }
}

export const transferService = new TransferService();
