import { pool } from '../config/db';

export interface DepartmentRecord {
  id: string;
  name: string;
  code: string;
  description: string | null;
  defaultMaxActiveRequests: number;
  isActive: boolean;
  deactivatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface DepartmentMetrics {
  activeAuthorityLevelsCount: number;
  activeStaffCount: number;
  activeCategoriesCount: number;
}

export interface DepartmentWithMetrics extends DepartmentRecord {
  metrics: DepartmentMetrics;
}

export interface DepartmentFilter {
  isActive?: boolean;
  search?: string;
  page: number;
  limit: number;
}

export class DepartmentRepository {
  /**
   * Creates a new department.
   */
  async create(data: {
    name: string;
    code: string;
    description?: string | null;
    defaultMaxActiveRequests: number;
  }): Promise<DepartmentRecord> {
    const query = `
      INSERT INTO departments (name, code, description, default_max_active_requests, is_active)
      VALUES ($1, $2, $3, $4, TRUE)
      RETURNING
        id,
        name,
        code,
        description,
        default_max_active_requests AS "defaultMaxActiveRequests",
        is_active AS "isActive",
        deactivated_at AS "deactivatedAt",
        created_at AS "createdAt",
        updated_at AS "updatedAt";
    `;
    const result = await pool.query(query, [
      data.name.trim(),
      data.code.trim().toUpperCase(),
      data.description ?? null,
      data.defaultMaxActiveRequests,
    ]);
    return result.rows[0] as DepartmentRecord;
  }

  /**
   * Retrieves department by ID.
   */
  async findById(id: string): Promise<DepartmentRecord | null> {
    const query = `
      SELECT
        id,
        name,
        code,
        description,
        default_max_active_requests AS "defaultMaxActiveRequests",
        is_active AS "isActive",
        deactivated_at AS "deactivatedAt",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM departments
      WHERE id = $1
      LIMIT 1;
    `;
    const result = await pool.query(query, [id]);
    if (result.rows.length === 0) {
      return null;
    }
    return result.rows[0] as DepartmentRecord;
  }

  /**
   * Retrieves department by ID with dynamically derived metrics (satisfies Clarification 5).
   */
  async findByIdWithMetrics(id: string): Promise<DepartmentWithMetrics | null> {
    const query = `
      SELECT
        d.id,
        d.name,
        d.code,
        d.description,
        d.default_max_active_requests AS "defaultMaxActiveRequests",
        d.is_active AS "isActive",
        d.deactivated_at AS "deactivatedAt",
        d.created_at AS "createdAt",
        d.updated_at AS "updatedAt",
        (
          SELECT COUNT(*)::int
          FROM department_authority_levels dal
          WHERE dal.department_id = d.id AND dal.is_active = TRUE
        ) AS "activeAuthorityLevelsCount",
        (
          SELECT COUNT(DISTINCT sdm.staff_user_id)::int
          FROM staff_department_memberships sdm
          WHERE sdm.department_id = d.id
            AND (sdm.valid_to IS NULL OR sdm.valid_to > NOW())
        ) AS "activeStaffCount",
        (
          SELECT COUNT(*)::int
          FROM categories c
          WHERE c.department_id = d.id AND c.is_active = TRUE
        ) AS "activeCategoriesCount"
      FROM departments d
      WHERE d.id = $1
      LIMIT 1;
    `;
    const result = await pool.query(query, [id]);
    if (result.rows.length === 0) {
      return null;
    }
    const row = result.rows[0];
    return {
      id: row.id,
      name: row.name,
      code: row.code,
      description: row.description,
      defaultMaxActiveRequests: row.defaultMaxActiveRequests,
      isActive: row.isActive,
      deactivatedAt: row.deactivatedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      metrics: {
        activeAuthorityLevelsCount: row.activeAuthorityLevelsCount,
        activeStaffCount: row.activeStaffCount,
        activeCategoriesCount: row.activeCategoriesCount,
      },
    };
  }

  /**
   * Retrieves paginated list of departments.
   */
  async findAll(filters: DepartmentFilter): Promise<{ departments: DepartmentRecord[]; total: number }> {
    const conditions: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (filters.isActive !== undefined) {
      conditions.push(`is_active = $${idx++}`);
      values.push(filters.isActive);
    }

    if (filters.search) {
      conditions.push(`(name ILIKE $${idx} OR code ILIKE $${idx})`);
      values.push(`%${filters.search}%`);
      idx++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countQuery = `
      SELECT COUNT(*)::int AS count
      FROM departments
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
        id,
        name,
        code,
        description,
        default_max_active_requests AS "defaultMaxActiveRequests",
        is_active AS "isActive",
        deactivated_at AS "deactivatedAt",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM departments
      ${whereClause}
      ORDER BY name ASC
      LIMIT ${limitParam} OFFSET ${offsetParam};
    `;

    const dataRes = await pool.query(dataQuery, values);
    return { departments: dataRes.rows as DepartmentRecord[], total };
  }

  /**
   * Updates department details.
   */
  async update(
    id: string,
    updates: {
      name?: string;
      description?: string | null;
      defaultMaxActiveRequests?: number;
    },
  ): Promise<DepartmentRecord | null> {
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
    if (updates.defaultMaxActiveRequests !== undefined) {
      fields.push(`default_max_active_requests = $${idx++}`);
      values.push(updates.defaultMaxActiveRequests);
    }

    if (fields.length === 0) {
      return this.findById(id);
    }

    fields.push('updated_at = NOW()');
    values.push(id);

    const query = `
      UPDATE departments
      SET ${fields.join(', ')}
      WHERE id = $${idx}
      RETURNING
        id,
        name,
        code,
        description,
        default_max_active_requests AS "defaultMaxActiveRequests",
        is_active AS "isActive",
        deactivated_at AS "deactivatedAt",
        created_at AS "createdAt",
        updated_at AS "updatedAt";
    `;

    const result = await pool.query(query, values);
    if (result.rows.length === 0) {
      return null;
    }
    return result.rows[0] as DepartmentRecord;
  }

  /**
   * Sets department active status respecting departments_deactivated_consistency constraint.
   */
  async setStatus(id: string, isActive: boolean): Promise<DepartmentRecord | null> {
    const query = `
      UPDATE departments
      SET
        is_active = $1,
        deactivated_at = CASE WHEN $1 = TRUE THEN NULL ELSE NOW() END,
        updated_at = NOW()
      WHERE id = $2
      RETURNING
        id,
        name,
        code,
        description,
        default_max_active_requests AS "defaultMaxActiveRequests",
        is_active AS "isActive",
        deactivated_at AS "deactivatedAt",
        created_at AS "createdAt",
        updated_at AS "updatedAt";
    `;
    const result = await pool.query(query, [isActive, id]);
    if (result.rows.length === 0) {
      return null;
    }
    return result.rows[0] as DepartmentRecord;
  }
}

export const departmentRepository = new DepartmentRepository();
