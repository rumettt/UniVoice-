import { PoolClient } from 'pg';
import { pool } from '../config/db';
import { RequestQueryInput } from '../validators/request.validators';

export interface RequestRecord {
  id: string;
  publicRef: string;
  title: string;
  description: string;
  studentId: string;
  categoryId: string;
  categoryName?: string;
  responsibleDepartmentId: string;
  responsibleDepartmentName?: string;
  responsibleDepartmentCode?: string;
  currentAuthorityLevelId: string;
  currentAuthorityLevelName?: string;
  currentAuthorityLevelOrder?: number;
  currentAssignmentId: string | null;
  currentEscalationId: string | null;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  status: 'pending' | 'assigned' | 'in_progress' | 'resolved' | 'closed' | 'rejected';
  dueAt: Date | null;
  resolutionNotes: string | null;
  resolvedAt: Date | null;
  closedAt: Date | null;
  rejectedAt: Date | null;
  reopenCount: number;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  student?: {
    id: string;
    fullName: string;
    email: string;
  };
  category?: {
    id: string;
    name: string;
  };
  department?: {
    id: string;
    name: string;
    code: string;
  };
  currentAuthorityLevel?: {
    id: string;
    name: string;
    levelOrder: number;
  };
}

export interface LockedCategoryRouting {
  categoryId: string;
  categoryName: string;
  categoryIsActive: boolean;
  defaultPriority: 'low' | 'medium' | 'high' | 'urgent';
  defaultDueHours: number | null;
  departmentId: string;
  departmentName: string;
  departmentCode: string;
  departmentIsActive: boolean;
  authorityLevelId: string;
  authorityLevelName: string;
  authorityLevelOrder: number;
  authorityLevelIsActive: boolean;
  authorityDepartmentId: string;
}

export class RequestRepository {
  /**
   * Finds a single request by its ID, excluding soft-deleted records.
   * Accepts an optional database client (for operations within an ongoing transaction).
   */
  async findById(id: string, client?: PoolClient): Promise<RequestRecord | null> {
    const query = `
      SELECT
        r.id,
        r.public_ref AS "publicRef",
        r.title,
        r.description,
        r.student_id AS "studentId",
        r.category_id AS "categoryId",
        r.responsible_department_id AS "responsibleDepartmentId",
        r.current_authority_level_id AS "currentAuthorityLevelId",
        r.current_assignment_id AS "currentAssignmentId",
        r.current_escalation_id AS "currentEscalationId",
        r.priority,
        r.status,
        r.due_at AS "dueAt",
        r.resolution_notes AS "resolutionNotes",
        r.resolved_at AS "resolvedAt",
        r.closed_at AS "closedAt",
        r.rejected_at AS "rejectedAt",
        r.reopen_count AS "reopenCount",
        r.deleted_at AS "deletedAt",
        r.created_at AS "createdAt",
        r.updated_at AS "updatedAt",
        u.full_name AS "studentFullName",
        u.email AS "studentEmail",
        c.name AS "categoryName",
        d.name AS "departmentName",
        d.code AS "departmentCode",
        dal.name AS "currentAuthorityLevelName",
        dal.level_order AS "currentAuthorityLevelOrder"
      FROM requests r
      JOIN users u ON r.student_id = u.id
      JOIN categories c ON r.category_id = c.id
      JOIN departments d ON r.responsible_department_id = d.id
      JOIN department_authority_levels dal ON r.current_authority_level_id = dal.id
      WHERE r.id = $1 AND r.deleted_at IS NULL
      LIMIT 1;
    `;

    const executor = client ?? pool;
    const res = await executor.query(query, [id]);
    if (res.rows.length === 0) {
      return null;
    }

    const row = res.rows[0];
    return this.mapRowToRecord(row);
  }

  /**
   * Locks and revalidates the category, department, and initial authority-level configuration
   * inside an existing transaction using row-level locking (FOR SHARE) to prevent concurrent
   * configuration changes during routing.
   */
  async lockAndGetCategoryRouting(
    categoryId: string,
    client: PoolClient,
  ): Promise<LockedCategoryRouting | null> {
    const lockQuery = `
      SELECT
        c.id AS "categoryId",
        c.name AS "categoryName",
        c.is_active AS "categoryIsActive",
        c.default_priority AS "defaultPriority",
        c.default_due_hours AS "defaultDueHours",
        d.id AS "departmentId",
        d.name AS "departmentName",
        d.code AS "departmentCode",
        d.is_active AS "departmentIsActive",
        dal.id AS "authorityLevelId",
        dal.name AS "authorityLevelName",
        dal.level_order AS "authorityLevelOrder",
        dal.is_active AS "authorityLevelIsActive",
        dal.department_id AS "authorityDepartmentId"
      FROM categories c
      JOIN departments d ON c.department_id = d.id
      JOIN department_authority_levels dal ON c.initial_authority_level_id = dal.id
      WHERE c.id = $1
      FOR SHARE OF c, d, dal;
    `;

    const res = await client.query(lockQuery, [categoryId]);
    if (res.rows.length === 0) {
      return null;
    }
    return res.rows[0] as LockedCategoryRouting;
  }

  /**
   * Generates a new unique public reference number using request_ref_seq.
   * Formats sequence values with at least 5 digits without truncating values exceeding 5 digits.
   */
  async generatePublicRef(client: PoolClient): Promise<string> {
    const query = `
      WITH seq AS (
        SELECT nextval('request_ref_seq') AS val
      )
      SELECT
        'REQ-' || TO_CHAR(NOW(), 'YYYY') || '-' || LPAD(seq.val::text, GREATEST(5, LENGTH(seq.val::text)), '0') AS ref
      FROM seq;
    `;
    const res = await client.query(query);
    return res.rows[0].ref;
  }

  /**
   * Creates a request inside an existing transaction client.
   * Note: The database trigger `trg_requests_lifecycle_history` automatically creates
   * the initial history record in the same transaction.
   */
  async insertRequest(
    params: {
      publicRef: string;
      title: string;
      description: string;
      studentId: string;
      categoryId: string;
      responsibleDepartmentId: string;
      currentAuthorityLevelId: string;
      priority: 'low' | 'medium' | 'high' | 'urgent';
      dueAt: Date | null;
    },
    client: PoolClient,
  ): Promise<RequestRecord> {
    const insertQuery = `
      INSERT INTO requests (
        public_ref,
        title,
        description,
        student_id,
        category_id,
        responsible_department_id,
        current_authority_level_id,
        current_assignment_id,
        current_escalation_id,
        created_by,
        updated_by,
        priority,
        status,
        due_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, NULL, NULL, $4, $4, $8, 'pending', $9
      )
      RETURNING id;
    `;

    const res = await client.query(insertQuery, [
      params.publicRef,
      params.title,
      params.description,
      params.studentId,
      params.categoryId,
      params.responsibleDepartmentId,
      params.currentAuthorityLevelId,
      params.priority,
      params.dueAt,
    ]);

    const createdId = res.rows[0].id;
    const request = await this.findById(createdId, client);
    if (!request) {
      throw new Error('Failed to retrieve newly created request');
    }
    return request;
  }

  /**
   * Finds requests submitted by a specific student with optional status/category filtering
   * and database-level pagination, excluding soft-deleted requests.
   */
  async findStudentRequests(
    studentId: string,
    filters: RequestQueryInput,
  ): Promise<{ requests: RequestRecord[]; total: number }> {
    const conditions: string[] = ['r.student_id = $1', 'r.deleted_at IS NULL'];
    const values: unknown[] = [studentId];
    let idx = 2;

    if (filters.status) {
      conditions.push(`r.status = $${idx++}`);
      values.push(filters.status);
    }

    if (filters.categoryId) {
      conditions.push(`r.category_id = $${idx++}`);
      values.push(filters.categoryId);
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`;

    const countQuery = `
      SELECT COUNT(*)::int AS count
      FROM requests r
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
        r.id,
        r.public_ref AS "publicRef",
        r.title,
        r.description,
        r.student_id AS "studentId",
        r.category_id AS "categoryId",
        r.responsible_department_id AS "responsibleDepartmentId",
        r.current_authority_level_id AS "currentAuthorityLevelId",
        r.current_assignment_id AS "currentAssignmentId",
        r.current_escalation_id AS "currentEscalationId",
        r.priority,
        r.status,
        r.due_at AS "dueAt",
        r.resolution_notes AS "resolutionNotes",
        r.resolved_at AS "resolvedAt",
        r.closed_at AS "closedAt",
        r.rejected_at AS "rejectedAt",
        r.reopen_count AS "reopenCount",
        r.deleted_at AS "deletedAt",
        r.created_at AS "createdAt",
        r.updated_at AS "updatedAt",
        c.name AS "categoryName",
        d.name AS "departmentName",
        d.code AS "departmentCode",
        dal.name AS "currentAuthorityLevelName",
        dal.level_order AS "currentAuthorityLevelOrder"
      FROM requests r
      JOIN categories c ON r.category_id = c.id
      JOIN departments d ON r.responsible_department_id = d.id
      JOIN department_authority_levels dal ON r.current_authority_level_id = dal.id
      ${whereClause}
      ORDER BY r.created_at DESC
      LIMIT ${limitParam} OFFSET ${offsetParam};
    `;

    const dataRes = await pool.query(dataQuery, values);
    const requests = dataRes.rows.map((row) => this.mapRowToRecord(row));
    return { requests, total };
  }

  private mapRowToRecord(row: Record<string, unknown>): RequestRecord {
    return {
      id: row.id as string,
      publicRef: row.publicRef as string,
      title: row.title as string,
      description: row.description as string,
      studentId: row.studentId as string,
      categoryId: row.categoryId as string,
      categoryName: (row.categoryName as string) ?? undefined,
      responsibleDepartmentId: row.responsibleDepartmentId as string,
      responsibleDepartmentName: (row.departmentName as string) ?? undefined,
      responsibleDepartmentCode: (row.departmentCode as string) ?? undefined,
      currentAuthorityLevelId: row.currentAuthorityLevelId as string,
      currentAuthorityLevelName: (row.currentAuthorityLevelName as string) ?? undefined,
      currentAuthorityLevelOrder: (row.currentAuthorityLevelOrder as number) ?? undefined,
      currentAssignmentId: (row.currentAssignmentId as string | null) ?? null,
      currentEscalationId: (row.currentEscalationId as string | null) ?? null,
      priority: row.priority as 'low' | 'medium' | 'high' | 'urgent',
      status: row.status as 'pending' | 'assigned' | 'in_progress' | 'resolved' | 'closed' | 'rejected',
      dueAt: (row.dueAt as Date | null) ?? null,
      resolutionNotes: (row.resolutionNotes as string | null) ?? null,
      resolvedAt: (row.resolvedAt as Date | null) ?? null,
      closedAt: (row.closedAt as Date | null) ?? null,
      rejectedAt: (row.rejectedAt as Date | null) ?? null,
      reopenCount: Number(row.reopenCount ?? 0),
      deletedAt: (row.deletedAt as Date | null) ?? null,
      createdAt: row.createdAt as Date,
      updatedAt: row.updatedAt as Date,
      student: row.studentFullName
        ? {
            id: row.studentId as string,
            fullName: row.studentFullName as string,
            email: row.studentEmail as string,
          }
        : undefined,
      category: row.categoryName
        ? {
            id: row.categoryId as string,
            name: row.categoryName as string,
          }
        : undefined,
      department: row.departmentName
        ? {
            id: row.responsibleDepartmentId as string,
            name: row.departmentName as string,
            code: row.departmentCode as string,
          }
        : undefined,
      currentAuthorityLevel: row.currentAuthorityLevelName
        ? {
            id: row.currentAuthorityLevelId as string,
            name: row.currentAuthorityLevelName as string,
            levelOrder: Number(row.currentAuthorityLevelOrder),
          }
        : undefined,
    };
  }
}

export const requestRepository = new RequestRepository();
