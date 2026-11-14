import { PoolClient } from 'pg';
import { pool } from '../config/db';
import { requestRepository, RequestRecord } from './request.repository';
import {
  ResolveRequestInput,
  RejectRequestInput,
  ReturnRequestInput,
  EscalateRequestInput,
} from '../validators/requestWorkflow.validators';

export class RequestWorkflowRepository {
  /**
   * Starts processing a claimed request (transitions 'assigned' -> 'in_progress').
   * Only the currently assigned staff member can start processing.
   * Row-locks the request row ('FOR UPDATE') to prevent concurrent conflicting state transitions.
   */
  async startProcessing(requestId: string, staffUserId: string): Promise<RequestRecord> {
    const client: PoolClient = await pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Lock request row FOR UPDATE
      const reqRes = await client.query(
        `SELECT id, status, current_assignment_id, deleted_at
         FROM requests
         WHERE id = $1
         FOR UPDATE;`,
        [requestId],
      );

      if (reqRes.rows.length === 0 || reqRes.rows[0].deleted_at !== null) {
        const notFoundErr = new Error(`Request ${requestId} not found`);
        (notFoundErr as unknown as { code: string }).code = 'not_found';
        throw notFoundErr;
      }

      const req = reqRes.rows[0];

      // 2. Must be in assigned status
      if (req.status !== 'assigned') {
        const invalidStatusErr = new Error(
          `Request cannot be started from status '${req.status}'. Only 'assigned' requests can transition to 'in_progress'.`,
        );
        (invalidStatusErr as unknown as { code: string }).code = 'invalid_transition';
        throw invalidStatusErr;
      }

      if (!req.current_assignment_id) {
        const noAssignErr = new Error(`Request ${requestId} has no active assignment`);
        (noAssignErr as unknown as { code: string }).code = 'invalid_transition';
        throw noAssignErr;
      }

      // 3. Verify that the staff member is the active assignee
      const assignRes = await client.query(
        `SELECT assignee_id FROM request_assignments
         WHERE id = $1 AND ended_at IS NULL;`,
        [req.current_assignment_id],
      );

      if (assignRes.rows.length === 0 || assignRes.rows[0].assignee_id !== staffUserId) {
        const forbiddenErr = new Error('Only the currently assigned staff member can start processing this request');
        (forbiddenErr as unknown as { code: string }).code = 'forbidden';
        throw forbiddenErr;
      }

      // 4. Update request status to in_progress
      // Trigger trg_requests_lifecycle_history records the lifecycle event with actor = staffUserId
      await client.query(
        `UPDATE requests
         SET status = 'in_progress',
             updated_by = $1,
             updated_at = NOW()
         WHERE id = $2;`,
        [staffUserId, requestId],
      );

      const updated = await requestRepository.findById(requestId, client);
      if (!updated) {
        throw new Error('Failed to retrieve updated request');
      }

      await client.query('COMMIT');
      return updated;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Resolves a request in 'in_progress' status.
   * Transitions atomically: 'in_progress' -> 'resolved' -> 'closed'.
   * Ends the active assignment in request_assignments (releases capacity).
   * Sets first_closed_at on first closure to anchor reopening window.
   * Trigger trg_requests_lifecycle_history records both 'resolved' and 'closed' events separately.
   */
  async resolveRequest(
    requestId: string,
    staffUserId: string,
    input: ResolveRequestInput,
  ): Promise<RequestRecord> {
    const client: PoolClient = await pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Lock request row FOR UPDATE
      const reqRes = await client.query(
        `SELECT id, status, current_assignment_id, first_closed_at, deleted_at
         FROM requests
         WHERE id = $1
         FOR UPDATE;`,
        [requestId],
      );

      if (reqRes.rows.length === 0 || reqRes.rows[0].deleted_at !== null) {
        const notFoundErr = new Error(`Request ${requestId} not found`);
        (notFoundErr as unknown as { code: string }).code = 'not_found';
        throw notFoundErr;
      }

      const req = reqRes.rows[0];

      // 2. Request must be in_progress
      if (req.status !== 'in_progress') {
        const invalidStatusErr = new Error(
          `Request cannot be resolved from status '${req.status}'. Only 'in_progress' requests can be resolved.`,
        );
        (invalidStatusErr as unknown as { code: string }).code = 'invalid_transition';
        throw invalidStatusErr;
      }

      if (!req.current_assignment_id) {
        const noAssignErr = new Error(`Request ${requestId} has no active assignment`);
        (noAssignErr as unknown as { code: string }).code = 'invalid_transition';
        throw noAssignErr;
      }

      // 3. Verify assignee is the staff member
      const assignRes = await client.query(
        `SELECT id, assignee_id FROM request_assignments
         WHERE id = $1 AND ended_at IS NULL;`,
        [req.current_assignment_id],
      );

      if (assignRes.rows.length === 0 || assignRes.rows[0].assignee_id !== staffUserId) {
        const forbiddenErr = new Error('Only the currently assigned staff member can resolve this request');
        (forbiddenErr as unknown as { code: string }).code = 'forbidden';
        throw forbiddenErr;
      }

      const assignmentId = assignRes.rows[0].id;

      // 4. Step 1: Transition to 'resolved' (Trigger records 'resolved' event with resolution details)
      await client.query(
        `UPDATE requests
         SET status = 'resolved',
             resolution_category = $1,
             resolution_notes = $2,
             resolved_at = NOW(),
             updated_by = $3,
             updated_at = NOW()
         WHERE id = $4;`,
        [input.resolutionCategory, input.resolutionMessage, staffUserId, requestId],
      );

      // 5. Step 2: Transition to 'closed', setting first_closed_at immutably on first closure
      // (Trigger records 'closed' event with closure details)
      await client.query(
        `UPDATE requests
         SET status = 'closed',
             closed_at = NOW(),
             first_closed_at = COALESCE(first_closed_at, NOW()),
             current_assignment_id = NULL,
             updated_by = $1,
             updated_at = NOW()
         WHERE id = $2;`,
        [staffUserId, requestId],
      );

      // 6. Step 3: End active assignment to release staff capacity
      await client.query(
        `UPDATE request_assignments
         SET ended_at = NOW()
         WHERE id = $1 AND ended_at IS NULL;`,
        [assignmentId],
      );

      const updated = await requestRepository.findById(requestId, client);
      if (!updated) {
        throw new Error('Failed to retrieve updated request');
      }

      await client.query('COMMIT');
      return updated;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Rejects a request from either 'assigned' or 'in_progress' status.
   * Only the currently assigned staff member can reject.
   * Mandatory rejection reason is saved on requests and in history.
   * Active assignment is ended to release staff capacity.
   * Rejection is final.
   */
  async rejectRequest(
    requestId: string,
    staffUserId: string,
    input: RejectRequestInput,
  ): Promise<RequestRecord> {
    const client: PoolClient = await pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Lock request row FOR UPDATE
      const reqRes = await client.query(
        `SELECT id, status, current_assignment_id, deleted_at
         FROM requests
         WHERE id = $1
         FOR UPDATE;`,
        [requestId],
      );

      if (reqRes.rows.length === 0 || reqRes.rows[0].deleted_at !== null) {
        const notFoundErr = new Error(`Request ${requestId} not found`);
        (notFoundErr as unknown as { code: string }).code = 'not_found';
        throw notFoundErr;
      }

      const req = reqRes.rows[0];

      // 2. Can only reject from assigned or in_progress status
      if (req.status !== 'assigned' && req.status !== 'in_progress') {
        const invalidStatusErr = new Error(
          `Request cannot be rejected from status '${req.status}'. Only 'assigned' or 'in_progress' requests can be rejected.`,
        );
        (invalidStatusErr as unknown as { code: string }).code = 'invalid_transition';
        throw invalidStatusErr;
      }

      if (!req.current_assignment_id) {
        const noAssignErr = new Error(`Request ${requestId} has no active assignment`);
        (noAssignErr as unknown as { code: string }).code = 'invalid_transition';
        throw noAssignErr;
      }

      // 3. Verify assignee is the staff member
      const assignRes = await client.query(
        `SELECT id, assignee_id FROM request_assignments
         WHERE id = $1 AND ended_at IS NULL;`,
        [req.current_assignment_id],
      );

      if (assignRes.rows.length === 0 || assignRes.rows[0].assignee_id !== staffUserId) {
        const forbiddenErr = new Error('Only the currently assigned staff member can reject this request');
        (forbiddenErr as unknown as { code: string }).code = 'forbidden';
        throw forbiddenErr;
      }

      const assignmentId = assignRes.rows[0].id;

      // 4. Update request to rejected
      await client.query(
        `UPDATE requests
         SET status = 'rejected',
             rejection_reason = $1,
             rejected_at = NOW(),
             current_assignment_id = NULL,
             updated_by = $2,
             updated_at = NOW()
         WHERE id = $3;`,
        [input.rejectionReason, staffUserId, requestId],
      );

      // 5. End active assignment to release staff capacity
      await client.query(
        `UPDATE request_assignments
         SET ended_at = NOW()
         WHERE id = $1 AND ended_at IS NULL;`,
        [assignmentId],
      );

      const updated = await requestRepository.findById(requestId, client);
      if (!updated) {
        throw new Error('Failed to retrieve updated request');
      }

      await client.query('COMMIT');
      return updated;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Reopens a closed request by the owning student.
   * Enforces:
   * 1. Student ownership (generic 404 if not found or belongs to another student).
   * 2. Request status must be 'closed'.
   * 3. reopen_count < maxReopenCount.
   * 4. NOW() <= first_closed_at + (reopenWindowDays * 24h). Reopening does not reset the window.
   * 5. Preserves current_authority_level_id.
   * 6. Sets current_assignment_id = NULL (re-enters authority queue in pending status).
   */
  async reopenRequest(
    requestId: string,
    studentUserId: string,
    reason: string,
    maxReopenCount: number,
    reopenWindowDays: number,
  ): Promise<RequestRecord> {
    const client: PoolClient = await pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Lock request row FOR UPDATE
      const reqRes = await client.query(
        `SELECT id, student_id, status, current_authority_level_id, reopen_count,
                first_closed_at, closed_at, resolved_at, deleted_at
         FROM requests
         WHERE id = $1
         FOR UPDATE;`,
        [requestId],
      );

      // Protect against private data leakage & ID enumeration
      if (
        reqRes.rows.length === 0 ||
        reqRes.rows[0].deleted_at !== null ||
        reqRes.rows[0].student_id !== studentUserId
      ) {
        const notFoundErr = new Error(`Request ${requestId} not found`);
        (notFoundErr as unknown as { code: string }).code = 'not_found';
        throw notFoundErr;
      }

      const req = reqRes.rows[0];

      // 2. Can only reopen from closed status
      if (req.status !== 'closed') {
        if (req.status === 'rejected') {
          const rejectedErr = new Error('Rejected requests are final and cannot be reopened');
          (rejectedErr as unknown as { code: string }).code = 'rejection_final';
          throw rejectedErr;
        }

        const invalidStatusErr = new Error(
          `Request cannot be reopened from status '${req.status}'. Only 'closed' requests can be reopened.`,
        );
        (invalidStatusErr as unknown as { code: string }).code = 'invalid_transition';
        throw invalidStatusErr;
      }

      // 3. Enforce maximum reopen count limit
      const currentReopenCount = Number(req.reopen_count ?? 0);
      if (currentReopenCount >= maxReopenCount) {
        const limitErr = new Error(
          `This request has reached the maximum allowed number of reopenings (${maxReopenCount}).`,
        );
        (limitErr as unknown as { code: string }).code = 'reopen_limit_exceeded';
        throw limitErr;
      }

      // 4. Enforce reopening time window against the immutable first closure timestamp
      const anchorDate = req.first_closed_at ?? req.closed_at ?? req.resolved_at ?? new Date();
      const windowMs = reopenWindowDays * 24 * 60 * 60 * 1000;
      const windowDeadline = new Date(new Date(anchorDate).getTime() + windowMs);

      if (Date.now() > windowDeadline.getTime()) {
        const windowErr = new Error(
          `The reopening time window of ${reopenWindowDays} days has expired. Request can no longer be reopened.`,
        );
        (windowErr as unknown as { code: string }).code = 'window_expired';
        throw windowErr;
      }

      // 5. Update request to pending:
      // - Increment reopen_count
      // - Store last_reopen_reason
      // - Set current_assignment_id = NULL (enters queue)
      // - Authority level is strictly PRESERVED (req.current_authority_level_id unchanged)
      // - Trigger trg_requests_lifecycle_history records 'reopened' lifecycle event with reason and new count
      await client.query(
        `UPDATE requests
         SET status = 'pending',
             current_assignment_id = NULL,
             reopen_count = reopen_count + 1,
             last_reopen_reason = $1,
             updated_by = $2,
             updated_at = NOW()
         WHERE id = $3;`,
        [reason, studentUserId, requestId],
      );

      const updated = await requestRepository.findById(requestId, client);
      if (!updated) {
        throw new Error('Failed to retrieve updated request');
      }

      await client.query('COMMIT');
      return updated;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Returns an assigned or in-progress request back to its department authority queue.
   * Business rules:
   * 1. Only the currently assigned staff member may return their request.
   * 2. Request must be assigned or in progress.
   * 3. A non-empty reason is mandatory.
   * 4. Ends active assignment (releases staff workload capacity).
   * 5. Sets status to 'pending' and current_assignment_id to NULL.
   * 6. Preserves department and authority level.
   * 7. Records return event and reason in request_history.
   */
  async returnRequest(
    requestId: string,
    staffUserId: string,
    input: ReturnRequestInput,
  ): Promise<RequestRecord> {
    const client: PoolClient = await pool.connect();
    try {
      await client.query('BEGIN');

      await client.query(
        'SELECT return_request_to_queue($1, $2, $3);',
        [requestId, staffUserId, input.reason],
      );

      const updated = await requestRepository.findById(requestId, client);
      if (!updated) {
        throw new Error('Failed to retrieve updated request');
      }

      await client.query('COMMIT');
      return updated;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Escalates an assigned or in-progress request to the next department authority queue.
   * Uses existing database procedure `escalate_request_to_queue(p_request_id, p_staff_user_id, p_reason, p_notes)`.
   * Business rules:
   * 1. Only the current handler may escalate.
   * 2. A non-empty reason is mandatory.
   * 3. Advances exactly one authority level within the same department.
   * 4. Ends current assignment and releases capacity.
   * 5. Returns request to next authority-level queue as pending.
   * 6. Preserves escalation history in request_escalations and request_history.
   * 7. Escalation at highest authority level is rejected.
   * 8. Repeated escalation is allowed until highest authority is reached.
   */
  async escalateRequest(
    requestId: string,
    staffUserId: string,
    input: EscalateRequestInput,
  ): Promise<{ request: RequestRecord; escalationId: string }> {
    const client: PoolClient = await pool.connect();
    try {
      await client.query('BEGIN');

      const res = await client.query(
        'SELECT escalate_request_to_queue($1, $2, $3, $4) AS "escalationId";',
        [requestId, staffUserId, input.reason, input.notes ?? null],
      );

      const escalationId = res.rows[0].escalationId as string;

      const updated = await requestRepository.findById(requestId, client);
      if (!updated) {
        throw new Error('Failed to retrieve updated request');
      }

      await client.query('COMMIT');
      return { request: updated, escalationId };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}

export const requestWorkflowRepository = new RequestWorkflowRepository();
