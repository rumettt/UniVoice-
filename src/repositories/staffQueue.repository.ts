import { PoolClient } from 'pg';
import { pool } from '../config/db';
import {
  StaffQueueQueryInput,
  StaffAssignmentsQueryInput,
} from '../validators/staffQueue.validators';

export interface StaffQueueItemRecord {
  id: string;
  publicRef: string;
  title: string;
  description: string;
  priority: 'urgent' | 'high' | 'medium' | 'low';
  status: 'pending';
  createdAt: Date;
  dueAt: Date | null;
  department: {
    id: string;
    name: string;
    code: string;
  };
  category: {
    id: string;
    name: string;
  };
  requiredAuthorityLevel: {
    id: string;
    name: string;
    levelOrder: number;
  };
}

export interface ClaimResultRecord {
  assignmentId: string;
  request: {
    id: string;
    publicRef: string;
    status: string;
    currentAssignmentId: string;
    claimedAt: Date;
  };
}

export interface StaffAssignmentRecord {
  assignmentId: string;
  assignedAt: Date;
  source: string;
  request: {
    id: string;
    publicRef: string;
    title: string;
    status: string;
    priority: string;
    dueAt: Date | null;
    department: {
      id: string;
      name: string;
      code: string;
    };
    category: {
      id: string;
      name: string;
    };
  };
}

export class StaffQueueRepository {
  /**
   * Retrieves paginated requests that the authenticated staff member is currently eligible to claim.
   * Enforces all eligibility invariants:
   * 1. Status is 'pending' and current_assignment_id is NULL.
   * 2. Request is not soft-deleted.
   * 3. Staff member has active membership in the request's department.
   * 4. Staff member's authority level order >= request authority level order (Threshold Rule).
   * 5. Staff member is authorized to handle the request category (can_handle = TRUE and active date range).
   * 6. Staff member is available in that department (is_available = TRUE).
   * 7. Staff member has remaining capacity (active assignments < effective capacity).
   */
  async findEligibleQueue(
    staffUserId: string,
    filters: StaffQueueQueryInput,
  ): Promise<{ queue: StaffQueueItemRecord[]; total: number }> {
    const conditions: string[] = [
      "r.status = 'pending'",
      'r.current_assignment_id IS NULL',
      'r.deleted_at IS NULL',
      'sde.is_available = TRUE',
      'sde.active_assignment_count < sde.effective_capacity',
      'sde.staff_level_order >= rdal.level_order',
      'sca.can_handle = TRUE',
      '(sca.valid_to IS NULL OR sca.valid_to > NOW())',
    ];
    const values: unknown[] = [staffUserId];
    let idx = 2;

    if (filters.departmentId) {
      conditions.push(`r.responsible_department_id = $${idx++}`);
      values.push(filters.departmentId);
    }

    if (filters.priority) {
      conditions.push(`r.priority = $${idx++}`);
      values.push(filters.priority);
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`;

    const cte = `
      WITH staff_dept_eligibility AS (
        SELECT
          sdm.department_id,
          dal.level_order AS staff_level_order,
          COALESCE(sdws.is_available, TRUE) AS is_available,
          COALESCE(sdws.max_active_requests_override, d.default_max_active_requests, 5) AS effective_capacity,
          (
            SELECT COUNT(*)::int
            FROM request_assignments ra
            WHERE ra.assignee_id = $1
              AND ra.department_id = sdm.department_id
              AND ra.ended_at IS NULL
          ) AS active_assignment_count
        FROM staff_department_memberships sdm
        JOIN users u ON u.id = $1 AND u.is_active = TRUE
        JOIN departments d ON sdm.department_id = d.id AND d.is_active = TRUE
        JOIN staff_department_authority_levels sdal ON sdal.staff_user_id = $1
          AND sdal.department_id = sdm.department_id
          AND (sdal.valid_to IS NULL OR sdal.valid_to > NOW())
        JOIN department_authority_levels dal ON sdal.department_authority_level_id = dal.id AND dal.is_active = TRUE
        LEFT JOIN staff_department_work_settings sdws ON sdws.staff_user_id = $1
          AND sdws.department_id = sdm.department_id
        WHERE sdm.staff_user_id = $1
          AND (sdm.valid_to IS NULL OR sdm.valid_to > NOW())
      )
    `;

    const countQuery = `
      ${cte}
      SELECT COUNT(*)::int AS count
      FROM requests r
      JOIN staff_dept_eligibility sde ON r.responsible_department_id = sde.department_id
      JOIN department_authority_levels rdal ON r.current_authority_level_id = rdal.id
      JOIN staff_category_authorizations sca ON sca.staff_user_id = $1
        AND sca.category_id = r.category_id
      ${whereClause};
    `;

    const countRes = await pool.query(countQuery, values);
    const total = countRes.rows[0]?.count ?? 0;

    const offset = (filters.page - 1) * filters.limit;
    values.push(filters.limit);
    const limitParam = `$${idx++}`;
    values.push(offset);
    const offsetParam = `$${idx++}`;

    const dataQuery = `
      ${cte}
      SELECT
        r.id,
        r.public_ref AS "publicRef",
        r.title,
        r.description,
        r.priority,
        r.status,
        r.created_at AS "createdAt",
        r.due_at AS "dueAt",
        d.id AS "departmentId",
        d.name AS "departmentName",
        d.code AS "departmentCode",
        c.id AS "categoryId",
        c.name AS "categoryName",
        rdal.id AS "authorityLevelId",
        rdal.name AS "authorityLevelName",
        rdal.level_order AS "authorityLevelOrder"
      FROM requests r
      JOIN staff_dept_eligibility sde ON r.responsible_department_id = sde.department_id
      JOIN departments d ON r.responsible_department_id = d.id
      JOIN categories c ON r.category_id = c.id
      JOIN department_authority_levels rdal ON r.current_authority_level_id = rdal.id
      JOIN staff_category_authorizations sca ON sca.staff_user_id = $1
        AND sca.category_id = r.category_id
      ${whereClause}
      ORDER BY
        CASE r.priority
          WHEN 'urgent' THEN 1
          WHEN 'high' THEN 2
          WHEN 'medium' THEN 3
          WHEN 'low' THEN 4
          ELSE 5
        END ASC,
        r.created_at ASC,
        r.id ASC
      LIMIT ${limitParam} OFFSET ${offsetParam};
    `;

    const dataRes = await pool.query(dataQuery, values);
    const queue = dataRes.rows.map((row) => this.mapRowToQueueItem(row));
    return { queue, total };
  }

  /**
   * Retrieves an individual queue item for inspection.
   * Revalidates that the staff member is currently eligible to claim this specific request.
   * Does NOT mutate request state, assignment, or history.
   */
  async findEligibleQueueItemById(
    staffUserId: string,
    requestId: string,
  ): Promise<StaffQueueItemRecord | null> {
    const query = `
      WITH staff_dept_eligibility AS (
        SELECT
          sdm.department_id,
          dal.level_order AS staff_level_order,
          COALESCE(sdws.is_available, TRUE) AS is_available,
          COALESCE(sdws.max_active_requests_override, d.default_max_active_requests, 5) AS effective_capacity,
          (
            SELECT COUNT(*)::int
            FROM request_assignments ra
            WHERE ra.assignee_id = $1
              AND ra.department_id = sdm.department_id
              AND ra.ended_at IS NULL
          ) AS active_assignment_count
        FROM staff_department_memberships sdm
        JOIN users u ON u.id = $1 AND u.is_active = TRUE
        JOIN departments d ON sdm.department_id = d.id AND d.is_active = TRUE
        JOIN staff_department_authority_levels sdal ON sdal.staff_user_id = $1
          AND sdal.department_id = sdm.department_id
          AND (sdal.valid_to IS NULL OR sdal.valid_to > NOW())
        JOIN department_authority_levels dal ON sdal.department_authority_level_id = dal.id AND dal.is_active = TRUE
        LEFT JOIN staff_department_work_settings sdws ON sdws.staff_user_id = $1
          AND sdws.department_id = sdm.department_id
        WHERE sdm.staff_user_id = $1
          AND (sdm.valid_to IS NULL OR sdm.valid_to > NOW())
      )
      SELECT
        r.id,
        r.public_ref AS "publicRef",
        r.title,
        r.description,
        r.priority,
        r.status,
        r.created_at AS "createdAt",
        r.due_at AS "dueAt",
        d.id AS "departmentId",
        d.name AS "departmentName",
        d.code AS "departmentCode",
        c.id AS "categoryId",
        c.name AS "categoryName",
        rdal.id AS "authorityLevelId",
        rdal.name AS "authorityLevelName",
        rdal.level_order AS "authorityLevelOrder"
      FROM requests r
      JOIN staff_dept_eligibility sde ON r.responsible_department_id = sde.department_id
      JOIN departments d ON r.responsible_department_id = d.id
      JOIN categories c ON r.category_id = c.id
      JOIN department_authority_levels rdal ON r.current_authority_level_id = rdal.id
      JOIN staff_category_authorizations sca ON sca.staff_user_id = $1
        AND sca.category_id = r.category_id
      WHERE r.id = $2
        AND r.status = 'pending'
        AND r.current_assignment_id IS NULL
        AND r.deleted_at IS NULL
        AND sde.is_available = TRUE
        AND sde.active_assignment_count < sde.effective_capacity
        AND sde.staff_level_order >= rdal.level_order
        AND sca.can_handle = TRUE
        AND (sca.valid_to IS NULL OR sca.valid_to > NOW())
      LIMIT 1;
    `;

    const res = await pool.query(query, [staffUserId, requestId]);
    if (res.rows.length === 0) {
      return null;
    }
    return this.mapRowToQueueItem(res.rows[0]);
  }

  /**
   * Atomically claims a request for a staff member.
   * Concurrency & Capacity Protection:
   * 1. Row-locks the request row ('FOR UPDATE') to prevent two staff members claiming the same request.
   * 2. Row-locks staff_department_work_settings for (staffUserId, departmentId) to serialize concurrent claims
   *    by the same staff member across different requests.
   * 3. Invokes PostgreSQL procedural function `claim_request(requestId, staffUserId)` which executes all checks,
   *    updates the request state, creates the assignment row, and records history.
   */
  async claimRequest(
    staffUserId: string,
    requestId: string,
  ): Promise<ClaimResultRecord> {
    const client: PoolClient = await pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Lock the request row first to resolve competing staff claims
      const reqRes = await client.query(
        `SELECT responsible_department_id, status, current_assignment_id, deleted_at
         FROM requests
         WHERE id = $1
         FOR UPDATE;`,
        [requestId],
      );

      if (reqRes.rows.length === 0 || reqRes.rows[0].deleted_at !== null) {
        const notFoundErr = new Error(`Request ${requestId} does not exist`);
        (notFoundErr as unknown as { code: string }).code = 'no_data_found';
        throw notFoundErr;
      }

      const reqRow = reqRes.rows[0];
      const deptId = reqRow.responsible_department_id;

      // 2. Lock the staff member's work settings row to serialize capacity checks for this staff in this dept.
      //    The row is provisioned atomically during department appointment; its absence indicates a data
      //    provisioning gap and must be surfaced explicitly rather than silently skipping the lock.
      const wsRes = await client.query(
        `SELECT 1 FROM staff_department_work_settings
         WHERE staff_user_id = $1 AND department_id = $2
         FOR UPDATE;`,
        [staffUserId, deptId],
      );

      if (wsRes.rows.length === 0) {
        const missingErr = new Error(
          `Work settings row missing for staff ${staffUserId} in department ${deptId}. ` +
          `Capacity serialization cannot proceed.`,
        );
        (missingErr as unknown as { code: string }).code = 'missing_work_settings';
        throw missingErr;
      }

      // 3. Execute authoritative claim procedure
      const claimRes = await client.query(
        'SELECT claim_request($1, $2) AS "assignmentId";',
        [requestId, staffUserId],
      );
      const assignmentId = claimRes.rows[0].assignmentId;

      // 4. Retrieve updated request details
      const updatedReqRes = await client.query(
        `SELECT id, public_ref AS "publicRef", status, current_assignment_id AS "currentAssignmentId", updated_at AS "updatedAt"
         FROM requests
         WHERE id = $1;`,
        [requestId],
      );
      const updatedReq = updatedReqRes.rows[0];

      await client.query('COMMIT');

      return {
        assignmentId,
        request: {
          id: updatedReq.id,
          publicRef: updatedReq.publicRef,
          status: updatedReq.status,
          currentAssignmentId: updatedReq.currentAssignmentId,
          claimedAt: updatedReq.updatedAt,
        },
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Retrieves requests currently actively assigned to the authenticated staff member.
   * Only returns records where ended_at IS NULL.
   */
  async findStaffActiveAssignments(
    staffUserId: string,
    filters: StaffAssignmentsQueryInput,
  ): Promise<{ assignments: StaffAssignmentRecord[]; total: number }> {
    const conditions: string[] = [
      'ra.assignee_id = $1',
      'ra.ended_at IS NULL',
      'r.deleted_at IS NULL',
      'r.current_assignment_id = ra.id',
    ];
    const values: unknown[] = [staffUserId];
    let idx = 2;

    if (filters.departmentId) {
      conditions.push(`ra.department_id = $${idx++}`);
      values.push(filters.departmentId);
    }

    if (filters.status) {
      conditions.push(`r.status = $${idx++}`);
      values.push(filters.status);
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`;

    const countQuery = `
      SELECT COUNT(*)::int AS count
      FROM request_assignments ra
      JOIN requests r ON ra.request_id = r.id
      ${whereClause};
    `;
    const countRes = await pool.query(countQuery, values);
    const total = countRes.rows[0]?.count ?? 0;

    const offset = (filters.page - 1) * filters.limit;
    values.push(filters.limit);
    const limitParam = `$${idx++}`;
    values.push(offset);
    const offsetParam = `$${idx++}`;

    const dataQuery = `
      SELECT
        ra.id AS "assignmentId",
        ra.started_at AS "assignedAt",
        ra.source,
        r.id AS "requestId",
        r.public_ref AS "publicRef",
        r.title,
        r.status,
        r.priority,
        r.due_at AS "dueAt",
        d.id AS "departmentId",
        d.name AS "departmentName",
        d.code AS "departmentCode",
        c.id AS "categoryId",
        c.name AS "categoryName"
      FROM request_assignments ra
      JOIN requests r ON ra.request_id = r.id
      JOIN departments d ON ra.department_id = d.id
      JOIN categories c ON r.category_id = c.id
      ${whereClause}
      ORDER BY ra.started_at DESC, ra.id ASC
      LIMIT ${limitParam} OFFSET ${offsetParam};
    `;

    const dataRes = await pool.query(dataQuery, values);
    const assignments: StaffAssignmentRecord[] = dataRes.rows.map((row) => ({
      assignmentId: row.assignmentId as string,
      assignedAt: row.assignedAt as Date,
      source: row.source as string,
      request: {
        id: row.requestId as string,
        publicRef: row.publicRef as string,
        title: row.title as string,
        status: row.status as string,
        priority: row.priority as string,
        dueAt: (row.dueAt as Date | null) ?? null,
        department: {
          id: row.departmentId as string,
          name: row.departmentName as string,
          code: row.departmentCode as string,
        },
        category: {
          id: row.categoryId as string,
          name: row.categoryName as string,
        },
      },
    }));

    return { assignments, total };
  }

  private mapRowToQueueItem(row: Record<string, unknown>): StaffQueueItemRecord {
    return {
      id: row.id as string,
      publicRef: row.publicRef as string,
      title: row.title as string,
      description: row.description as string,
      priority: row.priority as 'urgent' | 'high' | 'medium' | 'low',
      status: 'pending',
      createdAt: row.createdAt as Date,
      dueAt: (row.dueAt as Date | null) ?? null,
      department: {
        id: row.departmentId as string,
        name: row.departmentName as string,
        code: row.departmentCode as string,
      },
      category: {
        id: row.categoryId as string,
        name: row.categoryName as string,
      },
      requiredAuthorityLevel: {
        id: row.authorityLevelId as string,
        name: row.authorityLevelName as string,
        levelOrder: Number(row.authorityLevelOrder),
      },
    };
  }
}

export const staffQueueRepository = new StaffQueueRepository();
