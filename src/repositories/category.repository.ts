import { pool } from '../config/db';

export interface CategoryRecord {
  id: string;
  name: string;
  description: string | null;
  departmentId: string;
  departmentName?: string;
  initialAuthorityLevelId: string;
  initialAuthorityLevelName?: string;
  initialAuthorityLevelOrder?: number;
  defaultPriority: 'low' | 'medium' | 'high' | 'urgent';
  defaultDueHours: number | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CategoryFilter {
  departmentId?: string;
  isActive?: boolean;
  page: number;
  limit: number;
}

export class CategoryRepository {
  /**
   * Creates a new category.
   */
  async create(params: {
    name: string;
    description?: string | null;
    departmentId: string;
    initialAuthorityLevelId: string;
    defaultPriority?: 'low' | 'medium' | 'high' | 'urgent';
    defaultDueHours?: number | null;
  }): Promise<CategoryRecord> {
    const query = `
      INSERT INTO categories (
        name, description, department_id, initial_authority_level_id,
        default_priority, default_due_hours, is_active
      )
      VALUES ($1, $2, $3, $4, $5, $6, TRUE)
      RETURNING
        id,
        name,
        description,
        department_id AS "departmentId",
        initial_authority_level_id AS "initialAuthorityLevelId",
        default_priority AS "defaultPriority",
        default_due_hours AS "defaultDueHours",
        is_active AS "isActive",
        created_at AS "createdAt",
        updated_at AS "updatedAt";
    `;
    const res = await pool.query(query, [
      params.name.trim(),
      params.description ?? null,
      params.departmentId,
      params.initialAuthorityLevelId,
      params.defaultPriority ?? 'medium',
      params.defaultDueHours ?? null,
    ]);
    return this.findById(res.rows[0].id) as Promise<CategoryRecord>;
  }

  /**
   * Finds category by ID.
   */
  async findById(id: string): Promise<CategoryRecord | null> {
    const query = `
      SELECT
        c.id,
        c.name,
        c.description,
        c.department_id AS "departmentId",
        d.name AS "departmentName",
        c.initial_authority_level_id AS "initialAuthorityLevelId",
        dal.name AS "initialAuthorityLevelName",
        dal.level_order AS "initialAuthorityLevelOrder",
        c.default_priority AS "defaultPriority",
        c.default_due_hours AS "defaultDueHours",
        c.is_active AS "isActive",
        c.created_at AS "createdAt",
        c.updated_at AS "updatedAt"
      FROM categories c
      JOIN departments d ON c.department_id = d.id
      JOIN department_authority_levels dal ON c.initial_authority_level_id = dal.id
      WHERE c.id = $1
      LIMIT 1;
    `;
    const res = await pool.query(query, [id]);
    if (res.rows.length === 0) {
      return null;
    }
    return res.rows[0] as CategoryRecord;
  }

  /**
   * Finds categories with optional filtering.
   * Clarification 4: Distinguishes active categories from inactive categories.
   */
  async findAll(filters: CategoryFilter): Promise<{ categories: CategoryRecord[]; total: number }> {
    const conditions: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (filters.departmentId) {
      conditions.push(`c.department_id = $${idx++}`);
      values.push(filters.departmentId);
    }

    if (filters.isActive !== undefined) {
      conditions.push(`c.is_active = $${idx++}`);
      values.push(filters.isActive);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countQuery = `
      SELECT COUNT(*)::int AS count
      FROM categories c
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
        c.id,
        c.name,
        c.description,
        c.department_id AS "departmentId",
        d.name AS "departmentName",
        c.initial_authority_level_id AS "initialAuthorityLevelId",
        dal.name AS "initialAuthorityLevelName",
        dal.level_order AS "initialAuthorityLevelOrder",
        c.default_priority AS "defaultPriority",
        c.default_due_hours AS "defaultDueHours",
        c.is_active AS "isActive",
        c.created_at AS "createdAt",
        c.updated_at AS "updatedAt"
      FROM categories c
      JOIN departments d ON c.department_id = d.id
      JOIN department_authority_levels dal ON c.initial_authority_level_id = dal.id
      ${whereClause}
      ORDER BY d.name ASC, c.name ASC
      LIMIT ${limitParam} OFFSET ${offsetParam};
    `;
    const dataRes = await pool.query(dataQuery, values);
    return { categories: dataRes.rows as CategoryRecord[], total };
  }

  /**
   * Updates category information.
   */
  async update(
    id: string,
    updates: {
      name?: string;
      description?: string | null;
      departmentId?: string;
      initialAuthorityLevelId?: string;
      defaultPriority?: 'low' | 'medium' | 'high' | 'urgent';
      defaultDueHours?: number | null;
      isActive?: boolean;
    },
  ): Promise<CategoryRecord | null> {
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
    if (updates.departmentId !== undefined) {
      fields.push(`department_id = $${idx++}`);
      values.push(updates.departmentId);
    }
    if (updates.initialAuthorityLevelId !== undefined) {
      fields.push(`initial_authority_level_id = $${idx++}`);
      values.push(updates.initialAuthorityLevelId);
    }
    if (updates.defaultPriority !== undefined) {
      fields.push(`default_priority = $${idx++}`);
      values.push(updates.defaultPriority);
    }
    if (updates.defaultDueHours !== undefined) {
      fields.push(`default_due_hours = $${idx++}`);
      values.push(updates.defaultDueHours);
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
      UPDATE categories
      SET ${fields.join(', ')}
      WHERE id = $${idx}
      RETURNING id;
    `;
    const res = await pool.query(query, values);
    if (res.rows.length === 0) {
      return null;
    }
    return this.findById(id);
  }

  /**
   * Sets category active status.
   */
  async setStatus(id: string, isActive: boolean): Promise<CategoryRecord | null> {
    const query = `
      UPDATE categories
      SET is_active = $1, updated_at = NOW()
      WHERE id = $2
      RETURNING id;
    `;
    const res = await pool.query(query, [isActive, id]);
    if (res.rows.length === 0) {
      return null;
    }
    return this.findById(id);
  }
}

export const categoryRepository = new CategoryRepository();
