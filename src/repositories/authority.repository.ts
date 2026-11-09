import { PoolClient } from 'pg';
import { pool } from '../config/db';

export interface AuthorityLevelRecord {
  id: string;
  departmentId: string;
  code: string;
  name: string;
  levelOrder: number;
  description: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface StaffAuthorityAssignmentRecord {
  id: string;
  staffUserId: string;
  departmentAuthorityLevelId: string;
  departmentId: string;
  departmentName?: string;
  authorityLevelName?: string;
  authorityLevelCode?: string;
  levelOrder?: number;
  staffName?: string;
  staffEmail?: string;
  validFrom: Date;
  validTo: Date | null;
  createdAt: Date;
}

export class AuthorityRepository {
  /**
   * Creates a department authority level.
   */
  async create(params: {
    departmentId: string;
    code: string;
    name: string;
    levelOrder: number;
    description?: string | null;
  }): Promise<AuthorityLevelRecord> {
    const query = `
      INSERT INTO department_authority_levels (
        department_id, code, name, level_order, description, is_active
      )
      VALUES ($1, $2, $3, $4, $5, TRUE)
      RETURNING
        id,
        department_id AS "departmentId",
        code,
        name,
        level_order AS "levelOrder",
        description,
        is_active AS "isActive",
        created_at AS "createdAt",
        updated_at AS "updatedAt";
    `;
    const res = await pool.query(query, [
      params.departmentId,
      params.code.trim(),
      params.name.trim(),
      params.levelOrder,
      params.description ?? null,
    ]);
    return res.rows[0] as AuthorityLevelRecord;
  }

  /**
   * Retrieves authority level by ID.
   */
  async findById(id: string): Promise<AuthorityLevelRecord | null> {
    const query = `
      SELECT
        id,
        department_id AS "departmentId",
        code,
        name,
        level_order AS "levelOrder",
        description,
        is_active AS "isActive",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM department_authority_levels
      WHERE id = $1
      LIMIT 1;
    `;
    const res = await pool.query(query, [id]);
    if (res.rows.length === 0) {
      return null;
    }
    return res.rows[0] as AuthorityLevelRecord;
  }

  /**
   * Retrieves all authority levels for a department ordered by level_order ASC.
   */
  async findByDepartment(
    departmentId: string,
    activeOnly = false,
  ): Promise<AuthorityLevelRecord[]> {
    let whereClause = 'WHERE department_id = $1';
    if (activeOnly) {
      whereClause += ' AND is_active = TRUE';
    }

    const query = `
      SELECT
        id,
        department_id AS "departmentId",
        code,
        name,
        level_order AS "levelOrder",
        description,
        is_active AS "isActive",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM department_authority_levels
      ${whereClause}
      ORDER BY level_order ASC;
    `;
    const res = await pool.query(query, [departmentId]);
    return res.rows as AuthorityLevelRecord[];
  }

  /**
   * Updates an authority level.
   */
  async update(
    id: string,
    updates: {
      name?: string;
      description?: string | null;
      isActive?: boolean;
    },
  ): Promise<AuthorityLevelRecord | null> {
    const fields: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (updates.name !== undefined) {
      fields.push(`name = $${idx++}`);
      values.push(updates.name.trim());
    }
    if (updates.description !== undefined) {
      fields.push(`description = $${idx++}`);
      values.push(updates.description);
    }
    if (updates.isActive !== undefined) {
      fields.push(`is_active = $${idx++}`);
      values.push(updates.isActive);
    }

    if (fields.length === 0) {
      return this.findById(id);
    }

    fields.push('updated_at = NOW()');
    values.push(id);

    const query = `
      UPDATE department_authority_levels
      SET ${fields.join(', ')}
      WHERE id = $${idx}
      RETURNING
        id,
        department_id AS "departmentId",
        code,
        name,
        level_order AS "levelOrder",
        description,
        is_active AS "isActive",
        created_at AS "createdAt",
        updated_at AS "updatedAt";
    `;
    const res = await pool.query(query, values);
    if (res.rows.length === 0) {
      return null;
    }
    return res.rows[0] as AuthorityLevelRecord;
  }

  /**
   * Safely reorders authority levels for a department.
   * Satisfies Clarification 2: Uses a two-step temporary offset strategy inside a transaction
   * to avoid triggering the department-scoped unique level_order constraint during intermediate states.
   */
  async reorderLevels(
    departmentId: string,
    levels: { id: string; levelOrder: number }[],
  ): Promise<AuthorityLevelRecord[]> {
    const client: PoolClient = await pool.connect();
    try {
      await client.query('BEGIN');

      // Step 1: Temporarily shift all levels in the department by +10000 to prevent collisions
      await client.query(
        `UPDATE department_authority_levels
         SET level_order = level_order + 10000
         WHERE department_id = $1;`,
        [departmentId],
      );

      // Step 2: Apply the new level orders
      for (const item of levels) {
        await client.query(
          `UPDATE department_authority_levels
           SET level_order = $1, updated_at = NOW()
           WHERE id = $2 AND department_id = $3;`,
          [item.levelOrder, item.id, departmentId],
        );
      }

      await client.query('COMMIT');

      return this.findByDepartment(departmentId);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Assigns staff to department authority level.
   * Satisfies Clarification 3: Preserves assignment history by ending any existing active assignment.
   */
  async assignStaff(params: {
    staffUserId: string;
    departmentAuthorityLevelId: string;
    departmentId: string;
    validFrom?: Date;
    validTo?: Date | null;
  }): Promise<StaffAuthorityAssignmentRecord> {
    const client: PoolClient = await pool.connect();
    try {
      await client.query('BEGIN');

      const now = params.validFrom ?? new Date();

      // Close previous open-ended active authority assignment for this staff in this department
      await client.query(
        `UPDATE staff_department_authority_levels
         SET valid_to = $1
         WHERE staff_user_id = $2
           AND department_id = $3
           AND (valid_to IS NULL OR valid_to > $1);`,
        [now, params.staffUserId, params.departmentId],
      );

      // Insert new assignment
      const insertQuery = `
        INSERT INTO staff_department_authority_levels (
          staff_user_id, department_authority_level_id, department_id, valid_from, valid_to
        )
        VALUES ($1, $2, $3, $4, $5)
        RETURNING
          id,
          staff_user_id AS "staffUserId",
          department_authority_level_id AS "departmentAuthorityLevelId",
          department_id AS "departmentId",
          valid_from AS "validFrom",
          valid_to AS "validTo",
          created_at AS "createdAt";
      `;
      const res = await client.query(insertQuery, [
        params.staffUserId,
        params.departmentAuthorityLevelId,
        params.departmentId,
        now,
        params.validTo ?? null,
      ]);
      const record = res.rows[0];

      await client.query('COMMIT');
      return record as StaffAuthorityAssignmentRecord;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Ends an active staff authority level assignment.
   */
  async endStaffAssignment(
    staffUserId: string,
    departmentId: string,
    validTo?: Date,
  ): Promise<StaffAuthorityAssignmentRecord | null> {
    const endTimestamp = validTo ?? new Date();
    const query = `
      UPDATE staff_department_authority_levels
      SET valid_to = $1
      WHERE id = (
        SELECT id FROM staff_department_authority_levels
        WHERE staff_user_id = $2
          AND department_id = $3
          AND (valid_to IS NULL OR valid_to > $1)
        ORDER BY valid_from DESC
        LIMIT 1
      )
      RETURNING
        id,
        staff_user_id AS "staffUserId",
        department_authority_level_id AS "departmentAuthorityLevelId",
        department_id AS "departmentId",
        valid_from AS "validFrom",
        valid_to AS "validTo",
        created_at AS "createdAt";
    `;
    const res = await pool.query(query, [endTimestamp, staffUserId, departmentId]);
    if (res.rows.length === 0) {
      return null;
    }
    return res.rows[0] as StaffAuthorityAssignmentRecord;
  }

  /**
   * Retrieves active or all authority assignments for a staff member.
   */
  async findStaffAssignments(
    staffUserId: string,
    activeOnly = false,
  ): Promise<StaffAuthorityAssignmentRecord[]> {
    let whereClause = 'WHERE sdal.staff_user_id = $1';
    if (activeOnly) {
      whereClause += ' AND (sdal.valid_to IS NULL OR sdal.valid_to > NOW())';
    }

    const query = `
      SELECT
        sdal.id,
        sdal.staff_user_id AS "staffUserId",
        sdal.department_authority_level_id AS "departmentAuthorityLevelId",
        sdal.department_id AS "departmentId",
        sdal.valid_from AS "validFrom",
        sdal.valid_to AS "validTo",
        sdal.created_at AS "createdAt",
        dal.name AS "authorityLevelName",
        dal.code AS "authorityLevelCode",
        dal.level_order AS "levelOrder",
        d.name AS "departmentName"
      FROM staff_department_authority_levels sdal
      JOIN department_authority_levels dal ON sdal.department_authority_level_id = dal.id
      JOIN departments d ON sdal.department_id = d.id
      ${whereClause}
      ORDER BY sdal.valid_from DESC;
    `;
    const res = await pool.query(query, [staffUserId]);
    return res.rows as StaffAuthorityAssignmentRecord[];
  }
}

export const authorityRepository = new AuthorityRepository();
