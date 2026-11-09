import { PoolClient } from 'pg';
import { pool } from '../config/db';
import { AuthUser, UserRole } from '../types/auth';

export interface UserRecord extends AuthUser {
  passwordHash: string;
  isActive: boolean;
  phone?: string | null;
  profileImageUrl?: string | null;
  deactivatedAt?: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface StudentProfileRecord {
  studentNumber: string;
  programName: string | null;
}

export interface StaffProfileRecord {
  employeeNumber: string;
  currentPositionId: string | null;
}

export interface UserDetailRecord extends AuthUser {
  phone: string | null;
  profileImageUrl: string | null;
  isActive: boolean;
  deactivatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  departmentName?: string | null;
  departmentCode?: string | null;
  studentProfile?: StudentProfileRecord | null;
  staffProfile?: StaffProfileRecord | null;
}

export interface UserListFilter {
  role?: UserRole;
  departmentId?: string;
  isActive?: boolean;
  search?: string;
  page: number;
  limit: number;
}

export class UserRepository {
  /**
   * Finds a user by email (case-insensitive) including password hash and active status.
   */
  async findByEmail(email: string): Promise<UserRecord | null> {
    const query = `
      SELECT
        id,
        first_name AS "firstName",
        last_name AS "lastName",
        full_name AS "fullName",
        email,
        phone,
        password_hash AS "passwordHash",
        role,
        primary_department_id AS "primaryDepartmentId",
        profile_image_url AS "profileImageUrl",
        is_active AS "isActive",
        deactivated_at AS "deactivatedAt",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM users
      WHERE LOWER(email) = LOWER($1)
      LIMIT 1;
    `;
    const result = await pool.query(query, [email.trim()]);
    if (result.rows.length === 0) {
      return null;
    }
    return result.rows[0] as UserRecord;
  }

  /**
   * Finds a user by ID for token verification and /me profile.
   */
  async findById(id: string): Promise<(AuthUser & { isActive: boolean }) | null> {
    const query = `
      SELECT
        id,
        first_name AS "firstName",
        last_name AS "lastName",
        full_name AS "fullName",
        email,
        role,
        primary_department_id AS "primaryDepartmentId",
        is_active AS "isActive"
      FROM users
      WHERE id = $1
      LIMIT 1;
    `;
    const result = await pool.query(query, [id]);
    if (result.rows.length === 0) {
      return null;
    }
    return result.rows[0] as AuthUser & { isActive: boolean };
  }

  /**
   * Finds detailed user record including profiles and department name.
   */
  async findDetailById(id: string): Promise<UserDetailRecord | null> {
    const query = `
      SELECT
        u.id,
        u.first_name AS "firstName",
        u.last_name AS "lastName",
        u.full_name AS "fullName",
        u.email,
        u.phone,
        u.role,
        u.primary_department_id AS "primaryDepartmentId",
        u.profile_image_url AS "profileImageUrl",
        u.is_active AS "isActive",
        u.deactivated_at AS "deactivatedAt",
        u.created_at AS "createdAt",
        u.updated_at AS "updatedAt",
        d.name AS "departmentName",
        d.code AS "departmentCode",
        sp.student_number AS "studentNumber",
        sp.program_name AS "programName",
        stp.employee_number AS "employeeNumber",
        stp.current_position_id AS "currentPositionId"
      FROM users u
      LEFT JOIN departments d ON u.primary_department_id = d.id
      LEFT JOIN student_profiles sp ON u.id = sp.user_id
      LEFT JOIN staff_profiles stp ON u.id = stp.user_id
      WHERE u.id = $1
      LIMIT 1;
    `;
    const result = await pool.query(query, [id]);
    if (result.rows.length === 0) {
      return null;
    }
    const row = result.rows[0];
    return {
      id: row.id,
      firstName: row.firstName,
      lastName: row.lastName,
      fullName: row.fullName,
      email: row.email,
      phone: row.phone,
      role: row.role,
      primaryDepartmentId: row.primaryDepartmentId,
      profileImageUrl: row.profileImageUrl,
      isActive: row.isActive,
      deactivatedAt: row.deactivatedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      departmentName: row.departmentName,
      departmentCode: row.departmentCode,
      studentProfile: row.studentNumber
        ? {
            studentNumber: row.studentNumber,
            programName: row.programName,
          }
        : null,
      staffProfile: row.employeeNumber
        ? {
            employeeNumber: row.employeeNumber,
            currentPositionId: row.currentPositionId,
          }
        : null,
    };
  }

  /**
   * Lists users with filtering, search, and pagination.
   */
  async findAll(filters: UserListFilter): Promise<{ users: UserDetailRecord[]; total: number }> {
    const conditions: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (filters.role) {
      conditions.push(`u.role = $${idx++}`);
      values.push(filters.role);
    }

    if (filters.departmentId) {
      conditions.push(`u.primary_department_id = $${idx++}`);
      values.push(filters.departmentId);
    }

    if (filters.isActive !== undefined) {
      conditions.push(`u.is_active = $${idx++}`);
      values.push(filters.isActive);
    }

    if (filters.search) {
      conditions.push(
        `(u.email ILIKE $${idx} OR u.first_name ILIKE $${idx} OR u.last_name ILIKE $${idx})`,
      );
      values.push(`%${filters.search}%`);
      idx++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countQuery = `
      SELECT COUNT(*)::int AS count
      FROM users u
      ${whereClause};
    `;
    const countResult = await pool.query(countQuery, values);
    const total = countResult.rows[0]?.count ?? 0;

    const offset = (filters.page - 1) * filters.limit;
    values.push(filters.limit);
    const limitParam = `$${idx++}`;
    values.push(offset);
    const offsetParam = `$${idx++}`;

    const dataQuery = `
      SELECT
        u.id,
        u.first_name AS "firstName",
        u.last_name AS "lastName",
        u.full_name AS "fullName",
        u.email,
        u.phone,
        u.role,
        u.primary_department_id AS "primaryDepartmentId",
        u.profile_image_url AS "profileImageUrl",
        u.is_active AS "isActive",
        u.deactivated_at AS "deactivatedAt",
        u.created_at AS "createdAt",
        u.updated_at AS "updatedAt",
        d.name AS "departmentName",
        d.code AS "departmentCode",
        sp.student_number AS "studentNumber",
        sp.program_name AS "programName",
        stp.employee_number AS "employeeNumber",
        stp.current_position_id AS "currentPositionId"
      FROM users u
      LEFT JOIN departments d ON u.primary_department_id = d.id
      LEFT JOIN student_profiles sp ON u.id = sp.user_id
      LEFT JOIN staff_profiles stp ON u.id = stp.user_id
      ${whereClause}
      ORDER BY u.created_at DESC
      LIMIT ${limitParam} OFFSET ${offsetParam};
    `;

    const dataResult = await pool.query(dataQuery, values);
    const users: UserDetailRecord[] = dataResult.rows.map((row) => ({
      id: row.id,
      firstName: row.firstName,
      lastName: row.lastName,
      fullName: row.fullName,
      email: row.email,
      phone: row.phone,
      role: row.role,
      primaryDepartmentId: row.primaryDepartmentId,
      profileImageUrl: row.profileImageUrl,
      isActive: row.isActive,
      deactivatedAt: row.deactivatedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      departmentName: row.departmentName,
      departmentCode: row.departmentCode,
      studentProfile: row.studentNumber
        ? {
            studentNumber: row.studentNumber,
            programName: row.programName,
          }
        : null,
      staffProfile: row.employeeNumber
        ? {
            employeeNumber: row.employeeNumber,
            currentPositionId: row.currentPositionId,
          }
        : null,
    }));

    return { users, total };
  }

  /**
   * Transactional creation of student user and student_profiles.
   */
  async createStudent(params: {
    firstName: string;
    lastName: string;
    email: string;
    phone?: string | null;
    passwordHash: string;
    studentNumber: string;
    programName?: string | null;
    profileImageUrl?: string | null;
  }): Promise<UserDetailRecord> {
    const client: PoolClient = await pool.connect();
    try {
      await client.query('BEGIN');

      const userInsert = `
        INSERT INTO users (
          first_name, last_name, email, phone, password_hash, role,
          primary_department_id, profile_image_url, is_active
        )
        VALUES ($1, $2, $3, $4, $5, 'student', NULL, $6, TRUE)
        RETURNING
          id, first_name AS "firstName", last_name AS "lastName", full_name AS "fullName",
          email, phone, role, primary_department_id AS "primaryDepartmentId",
          profile_image_url AS "profileImageUrl", is_active AS "isActive",
          deactivated_at AS "deactivatedAt", created_at AS "createdAt", updated_at AS "updatedAt";
      `;
      const userRes = await client.query(userInsert, [
        params.firstName,
        params.lastName,
        params.email.toLowerCase().trim(),
        params.phone ?? null,
        params.passwordHash,
        params.profileImageUrl ?? null,
      ]);
      const user = userRes.rows[0];

      const profileInsert = `
        INSERT INTO student_profiles (user_id, student_number, program_name)
        VALUES ($1, $2, $3)
        RETURNING student_number AS "studentNumber", program_name AS "programName";
      `;
      const profRes = await client.query(profileInsert, [
        user.id,
        params.studentNumber.trim(),
        params.programName ?? null,
      ]);
      const profile = profRes.rows[0];

      await client.query('COMMIT');

      return {
        ...user,
        departmentName: null,
        departmentCode: null,
        studentProfile: {
          studentNumber: profile.studentNumber,
          programName: profile.programName,
        },
        staffProfile: null,
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Transactional creation of staff user, staff_profiles, and initial staff_department_memberships.
   * Satisfies Clarification 1.
   */
  async createStaff(params: {
    firstName: string;
    lastName: string;
    email: string;
    phone?: string | null;
    passwordHash: string;
    employeeNumber: string;
    primaryDepartmentId: string;
    currentPositionId?: string | null;
    profileImageUrl?: string | null;
  }): Promise<UserDetailRecord> {
    const client: PoolClient = await pool.connect();
    try {
      await client.query('BEGIN');

      const userInsert = `
        INSERT INTO users (
          first_name, last_name, email, phone, password_hash, role,
          primary_department_id, profile_image_url, is_active
        )
        VALUES ($1, $2, $3, $4, $5, 'staff', $6, $7, TRUE)
        RETURNING
          id, first_name AS "firstName", last_name AS "lastName", full_name AS "fullName",
          email, phone, role, primary_department_id AS "primaryDepartmentId",
          profile_image_url AS "profileImageUrl", is_active AS "isActive",
          deactivated_at AS "deactivatedAt", created_at AS "createdAt", updated_at AS "updatedAt";
      `;
      const userRes = await client.query(userInsert, [
        params.firstName,
        params.lastName,
        params.email.toLowerCase().trim(),
        params.phone ?? null,
        params.passwordHash,
        params.primaryDepartmentId,
        params.profileImageUrl ?? null,
      ]);
      const user = userRes.rows[0];

      const profileInsert = `
        INSERT INTO staff_profiles (user_id, employee_number, current_position_id)
        VALUES ($1, $2, $3)
        RETURNING employee_number AS "employeeNumber", current_position_id AS "currentPositionId";
      `;
      const profRes = await client.query(profileInsert, [
        user.id,
        params.employeeNumber.trim(),
        params.currentPositionId ?? null,
      ]);
      const profile = profRes.rows[0];

      // Insert initial primary membership in staff_department_memberships
      const membershipInsert = `
        INSERT INTO staff_department_memberships (
          staff_user_id, department_id, is_primary, valid_from
        )
        VALUES ($1, $2, TRUE, NOW());
      `;
      await client.query(membershipInsert, [user.id, params.primaryDepartmentId]);

      // Initialize default work settings row
      const workSettingsInsert = `
        INSERT INTO staff_department_work_settings (
          staff_user_id, department_id, is_available, max_active_requests_override
        )
        VALUES ($1, $2, TRUE, NULL)
        ON CONFLICT (staff_user_id, department_id) DO NOTHING;
      `;
      await client.query(workSettingsInsert, [user.id, params.primaryDepartmentId]);

      await client.query('COMMIT');

      return {
        ...user,
        studentProfile: null,
        staffProfile: {
          employeeNumber: profile.employeeNumber,
          currentPositionId: profile.currentPositionId,
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
   * Transactional creation of admin user and optional staff profile/membership.
   */
  async createAdmin(params: {
    firstName: string;
    lastName: string;
    email: string;
    phone?: string | null;
    passwordHash: string;
    primaryDepartmentId?: string | null;
    employeeNumber?: string | null;
    currentPositionId?: string | null;
    profileImageUrl?: string | null;
  }): Promise<UserDetailRecord> {
    const client: PoolClient = await pool.connect();
    try {
      await client.query('BEGIN');

      const userInsert = `
        INSERT INTO users (
          first_name, last_name, email, phone, password_hash, role,
          primary_department_id, profile_image_url, is_active
        )
        VALUES ($1, $2, $3, $4, $5, 'admin', $6, $7, TRUE)
        RETURNING
          id, first_name AS "firstName", last_name AS "lastName", full_name AS "fullName",
          email, phone, role, primary_department_id AS "primaryDepartmentId",
          profile_image_url AS "profileImageUrl", is_active AS "isActive",
          deactivated_at AS "deactivatedAt", created_at AS "createdAt", updated_at AS "updatedAt";
      `;
      const userRes = await client.query(userInsert, [
        params.firstName,
        params.lastName,
        params.email.toLowerCase().trim(),
        params.phone ?? null,
        params.passwordHash,
        params.primaryDepartmentId ?? null,
        params.profileImageUrl ?? null,
      ]);
      const user = userRes.rows[0];

      let staffProfile: StaffProfileRecord | null = null;
      if (params.employeeNumber) {
        const profileInsert = `
          INSERT INTO staff_profiles (user_id, employee_number, current_position_id)
          VALUES ($1, $2, $3)
          RETURNING employee_number AS "employeeNumber", current_position_id AS "currentPositionId";
        `;
        const profRes = await client.query(profileInsert, [
          user.id,
          params.employeeNumber.trim(),
          params.currentPositionId ?? null,
        ]);
        staffProfile = {
          employeeNumber: profRes.rows[0].employeeNumber,
          currentPositionId: profRes.rows[0].currentPositionId,
        };

        if (params.primaryDepartmentId) {
          const membershipInsert = `
            INSERT INTO staff_department_memberships (
              staff_user_id, department_id, is_primary, valid_from
            )
            VALUES ($1, $2, TRUE, NOW());
          `;
          await client.query(membershipInsert, [user.id, params.primaryDepartmentId]);
        }
      }

      await client.query('COMMIT');

      return {
        ...user,
        studentProfile: null,
        staffProfile,
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Updates user profile attributes.
   */
  async updateProfile(
    id: string,
    updates: {
      firstName?: string;
      lastName?: string;
      phone?: string | null;
      profileImageUrl?: string | null;
    },
  ): Promise<UserDetailRecord | null> {
    const fields: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (updates.firstName !== undefined) {
      fields.push(`first_name = $${idx++}`);
      values.push(updates.firstName);
    }
    if (updates.lastName !== undefined) {
      fields.push(`last_name = $${idx++}`);
      values.push(updates.lastName);
    }
    if (updates.phone !== undefined) {
      fields.push(`phone = $${idx++}`);
      values.push(updates.phone);
    }
    if (updates.profileImageUrl !== undefined) {
      fields.push(`profile_image_url = $${idx++}`);
      values.push(updates.profileImageUrl);
    }

    if (fields.length === 0) {
      return this.findDetailById(id);
    }

    fields.push('updated_at = NOW()');
    values.push(id);

    const query = `
      UPDATE users
      SET ${fields.join(', ')}
      WHERE id = $${idx}
      RETURNING id;
    `;

    const result = await pool.query(query, values);
    if (result.rows.length === 0) {
      return null;
    }
    return this.findDetailById(id);
  }

  /**
   * Sets user activation status respecting users_deactivated_consistency constraint.
   */
  async setStatus(id: string, isActive: boolean): Promise<UserDetailRecord | null> {
    const query = `
      UPDATE users
      SET
        is_active = $1,
        deactivated_at = CASE WHEN $1 = TRUE THEN NULL ELSE NOW() END,
        updated_at = NOW()
      WHERE id = $2
      RETURNING id;
    `;
    const result = await pool.query(query, [isActive, id]);
    if (result.rows.length === 0) {
      return null;
    }

    if (!isActive) {
      // Revoke refresh tokens on deactivation
      await pool.query(
        `UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL;`,
        [id],
      );
    }

    return this.findDetailById(id);
  }

  /**
   * Updates last_login_at timestamp upon successful authentication.
   */
  async updateLastLogin(id: string): Promise<void> {
    const query = `
      UPDATE users
      SET last_login_at = NOW(), updated_at = NOW()
      WHERE id = $1;
    `;
    await pool.query(query, [id]);
  }
}

export const userRepository = new UserRepository();
