import { PoolClient } from 'pg';
import { pool } from '../config/db';

export interface StaffMembershipRecord {
  id: string;
  staffUserId: string;
  departmentId: string;
  departmentName?: string;
  departmentCode?: string;
  staffName?: string;
  staffEmail?: string;
  employeeNumber?: string;
  isPrimary: boolean;
  validFrom: Date;
  validTo: Date | null;
  createdAt: Date;
}

export interface StaffWorkSettingsRecord {
  id: string;
  staffUserId: string;
  departmentId: string;
  isAvailable: boolean;
  maxActiveRequestsOverride: number | null;
  departmentDefaultMaxActiveRequests: number;
  effectiveMaxActiveRequests: number;
  createdAt: Date;
  updatedAt: Date;
}

export class StaffRepository {
  /**
   * Assigns staff member to a department.
   * Clarification 3: Preserves effective-dated history by closing any existing active
   * record (valid_to = validFrom) rather than deleting or overwriting it.
   */
  async assignDepartment(params: {
    staffUserId: string;
    departmentId: string;
    isPrimary?: boolean;
    validFrom?: Date;
    validTo?: Date | null;
  }): Promise<StaffMembershipRecord> {
    const client: PoolClient = await pool.connect();
    try {
      await client.query('BEGIN');

      const now = params.validFrom ?? new Date();

      // If making this the primary department, clear is_primary on existing primary memberships
      if (params.isPrimary) {
        await client.query(
          `UPDATE staff_department_memberships
           SET is_primary = FALSE
           WHERE staff_user_id = $1 AND is_primary = TRUE;`,
          [params.staffUserId],
        );

        // Also update primary_department_id on users table
        await client.query(
          `UPDATE users
           SET primary_department_id = $1, updated_at = NOW()
           WHERE id = $2;`,
          [params.departmentId, params.staffUserId],
        );
      }

      // Close previous open-ended active membership for this department if exists
      await client.query(
        `UPDATE staff_department_memberships
         SET valid_to = $1
         WHERE staff_user_id = $2
           AND department_id = $3
           AND (valid_to IS NULL OR valid_to > $1);`,
        [now, params.staffUserId, params.departmentId],
      );

      // Insert new membership record
      const insertQuery = `
        INSERT INTO staff_department_memberships (
          staff_user_id, department_id, is_primary, valid_from, valid_to
        )
        VALUES ($1, $2, $3, $4, $5)
        RETURNING
          id,
          staff_user_id AS "staffUserId",
          department_id AS "departmentId",
          is_primary AS "isPrimary",
          valid_from AS "validFrom",
          valid_to AS "validTo",
          created_at AS "createdAt";
      `;
      const res = await client.query(insertQuery, [
        params.staffUserId,
        params.departmentId,
        params.isPrimary ?? false,
        now,
        params.validTo ?? null,
      ]);
      const record = res.rows[0];

      // Ensure a work settings row exists for this staff in this department
      await client.query(
        `INSERT INTO staff_department_work_settings (
          staff_user_id, department_id, is_available, max_active_requests_override
        )
        VALUES ($1, $2, TRUE, NULL)
        ON CONFLICT (staff_user_id, department_id) DO NOTHING;`,
        [params.staffUserId, params.departmentId],
      );

      await client.query('COMMIT');
      return record as StaffMembershipRecord;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Ends an active staff department appointment.
   * Satisfies Clarification 3 by setting valid_to instead of deleting.
   */
  async endDepartmentMembership(
    staffUserId: string,
    departmentId: string,
    validTo?: Date,
  ): Promise<StaffMembershipRecord | null> {
    const endTimestamp = validTo ?? new Date();
    const query = `
      UPDATE staff_department_memberships
      SET valid_to = $1
      WHERE id = (
        SELECT id FROM staff_department_memberships
        WHERE staff_user_id = $2
          AND department_id = $3
          AND (valid_to IS NULL OR valid_to > $1)
        ORDER BY valid_from DESC
        LIMIT 1
      )
      RETURNING
        id,
        staff_user_id AS "staffUserId",
        department_id AS "departmentId",
        is_primary AS "isPrimary",
        valid_from AS "validFrom",
        valid_to AS "validTo",
        created_at AS "createdAt";
    `;
    const res = await pool.query(query, [endTimestamp, staffUserId, departmentId]);
    if (res.rows.length === 0) {
      return null;
    }
    return res.rows[0] as StaffMembershipRecord;
  }

  /**
   * Retrieves all departments a staff member belongs to (active and past).
   */
  async findDepartmentsByStaff(
    staffUserId: string,
    activeOnly = false,
  ): Promise<StaffMembershipRecord[]> {
    let whereClause = 'WHERE sdm.staff_user_id = $1';
    if (activeOnly) {
      whereClause += ' AND (sdm.valid_to IS NULL OR sdm.valid_to > NOW())';
    }

    const query = `
      SELECT
        sdm.id,
        sdm.staff_user_id AS "staffUserId",
        sdm.department_id AS "departmentId",
        sdm.is_primary AS "isPrimary",
        sdm.valid_from AS "validFrom",
        sdm.valid_to AS "validTo",
        sdm.created_at AS "createdAt",
        d.name AS "departmentName",
        d.code AS "departmentCode"
      FROM staff_department_memberships sdm
      JOIN departments d ON sdm.department_id = d.id
      ${whereClause}
      ORDER BY sdm.is_primary DESC, sdm.valid_from DESC;
    `;
    const res = await pool.query(query, [staffUserId]);
    return res.rows as StaffMembershipRecord[];
  }

  /**
   * Retrieves all staff members in a department.
   */
  async findStaffByDepartment(
    departmentId: string,
    activeOnly = false,
  ): Promise<StaffMembershipRecord[]> {
    let whereClause = 'WHERE sdm.department_id = $1';
    if (activeOnly) {
      whereClause += ' AND (sdm.valid_to IS NULL OR sdm.valid_to > NOW())';
    }

    const query = `
      SELECT
        sdm.id,
        sdm.staff_user_id AS "staffUserId",
        sdm.department_id AS "departmentId",
        sdm.is_primary AS "isPrimary",
        sdm.valid_from AS "validFrom",
        sdm.valid_to AS "validTo",
        sdm.created_at AS "createdAt",
        u.full_name AS "staffName",
        u.email AS "staffEmail",
        sp.employee_number AS "employeeNumber"
      FROM staff_department_memberships sdm
      JOIN users u ON sdm.staff_user_id = u.id
      LEFT JOIN staff_profiles sp ON u.id = sp.user_id
      ${whereClause}
      ORDER BY u.last_name ASC, u.first_name ASC;
    `;
    const res = await pool.query(query, [departmentId]);
    return res.rows as StaffMembershipRecord[];
  }

  /**
   * Retrieves staff work settings with derived effective capacity.
   */
  async getWorkSettings(
    staffUserId: string,
    departmentId: string,
  ): Promise<StaffWorkSettingsRecord | null> {
    const query = `
      SELECT
        ws.id,
        ws.staff_user_id AS "staffUserId",
        ws.department_id AS "departmentId",
        ws.is_available AS "isAvailable",
        ws.max_active_requests_override AS "maxActiveRequestsOverride",
        d.default_max_active_requests AS "departmentDefaultMaxActiveRequests",
        COALESCE(ws.max_active_requests_override, d.default_max_active_requests) AS "effectiveMaxActiveRequests",
        ws.created_at AS "createdAt",
        ws.updated_at AS "updatedAt"
      FROM departments d
      LEFT JOIN staff_department_work_settings ws
        ON ws.department_id = d.id AND ws.staff_user_id = $1
      WHERE d.id = $2
      LIMIT 1;
    `;
    const res = await pool.query(query, [staffUserId, departmentId]);
    if (res.rows.length === 0 || !res.rows[0].id) {
      return null;
    }
    return res.rows[0] as StaffWorkSettingsRecord;
  }

  /**
   * Upserts staff work settings for a department.
   */
  async upsertWorkSettings(params: {
    staffUserId: string;
    departmentId: string;
    isAvailable?: boolean;
    maxActiveRequestsOverride?: number | null;
  }): Promise<StaffWorkSettingsRecord> {
    const current = await this.getWorkSettings(params.staffUserId, params.departmentId);

    const isAvailable = params.isAvailable !== undefined
      ? params.isAvailable
      : (current ? current.isAvailable : true);

    const override = params.maxActiveRequestsOverride !== undefined
      ? params.maxActiveRequestsOverride
      : (current ? current.maxActiveRequestsOverride : null);

    const query = `
      INSERT INTO staff_department_work_settings (
        staff_user_id, department_id, is_available, max_active_requests_override, updated_at
      )
      VALUES ($1, $2, $3, $4, NOW())
      ON CONFLICT (staff_user_id, department_id) DO UPDATE
      SET
        is_available = EXCLUDED.is_available,
        max_active_requests_override = EXCLUDED.max_active_requests_override,
        updated_at = NOW()
      RETURNING id;
    `;
    await pool.query(query, [params.staffUserId, params.departmentId, isAvailable, override]);

    const updated = await this.getWorkSettings(params.staffUserId, params.departmentId);
    return updated!;
  }
}

export const staffRepository = new StaffRepository();
