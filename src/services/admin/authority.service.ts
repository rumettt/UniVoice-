import {
  authorityRepository,
  AuthorityLevelRecord,
  StaffAuthorityAssignmentRecord,
} from '../../repositories/authority.repository';
import { departmentRepository } from '../../repositories/department.repository';
import { staffRepository } from '../../repositories/staff.repository';
import { userRepository } from '../../repositories/user.repository';
import { AppError } from '../../utils/AppError';
import {
  CreateAuthorityLevelInput,
  UpdateAuthorityLevelInput,
  ReorderAuthorityLevelsInput,
  AssignStaffAuthorityLevelInput,
} from '../../validators/authority.validators';

export class AuthorityService {
  /**
   * Creates an authority level for a department.
   */
  async createAuthorityLevel(input: CreateAuthorityLevelInput): Promise<AuthorityLevelRecord> {
    const department = await departmentRepository.findById(input.departmentId);
    if (!department) {
      throw new AppError('Department not found', 404);
    }

    try {
      return await authorityRepository.create(input);
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'code' in err && err.code === '23505') {
        throw new AppError(
          'An authority level with this code, name, or level_order already exists in this department',
          409,
        );
      }
      throw err;
    }
  }

  /**
   * Retrieves all authority levels for a department ordered by level_order ASC.
   */
  async getAuthorityLevels(
    departmentId: string,
    activeOnly = false,
  ): Promise<AuthorityLevelRecord[]> {
    const department = await departmentRepository.findById(departmentId);
    if (!department) {
      throw new AppError('Department not found', 404);
    }
    return authorityRepository.findByDepartment(departmentId, activeOnly);
  }

  /**
   * Updates an authority level.
   */
  async updateAuthorityLevel(
    id: string,
    updates: UpdateAuthorityLevelInput,
  ): Promise<AuthorityLevelRecord> {
    const existing = await authorityRepository.findById(id);
    if (!existing) {
      throw new AppError('Authority level not found', 404);
    }

    try {
      const updated = await authorityRepository.update(id, updates);
      if (!updated) {
        throw new AppError('Failed to update authority level', 500);
      }
      return updated;
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'code' in err && err.code === '23505') {
        throw new AppError('An authority level with this name already exists in this department', 409);
      }
      throw err;
    }
  }

  /**
   * Reorders authority levels safely for a department.
   * Satisfies Clarification 2.
   */
  async reorderAuthorityLevels(input: ReorderAuthorityLevelsInput): Promise<AuthorityLevelRecord[]> {
    const department = await departmentRepository.findById(input.departmentId);
    if (!department) {
      throw new AppError('Department not found', 404);
    }

    const existingLevels = await authorityRepository.findByDepartment(input.departmentId);
    const existingIds = new Set(existingLevels.map((l) => l.id));

    // Verify all requested level IDs belong to this department
    for (const item of input.levels) {
      if (!existingIds.has(item.id)) {
        throw new AppError(
          `Authority level ${item.id} does not belong to department ${input.departmentId}`,
          400,
        );
      }
    }

    // Verify all requested level orders are unique
    const requestedOrders = input.levels.map((l) => l.levelOrder);
    const uniqueOrders = new Set(requestedOrders);
    if (uniqueOrders.size !== requestedOrders.length) {
      throw new AppError('Authority level orders must be distinct within the department', 400);
    }

    return authorityRepository.reorderLevels(input.departmentId, input.levels);
  }

  /**
   * Assigns a staff member to an authority level within their department.
   * Validates cross-department constraints and department membership.
   */
  async assignStaffAuthority(
    input: AssignStaffAuthorityLevelInput,
  ): Promise<StaffAuthorityAssignmentRecord> {
    const user = await userRepository.findById(input.staffUserId);
    if (!user) {
      throw new AppError('Staff user not found', 404);
    }

    const department = await departmentRepository.findById(input.departmentId);
    if (!department) {
      throw new AppError('Department not found', 404);
    }

    const authorityLevel = await authorityRepository.findById(input.departmentAuthorityLevelId);
    if (!authorityLevel) {
      throw new AppError('Authority level not found', 404);
    }

    // Cross-department integrity check: Level must belong to department
    if (authorityLevel.departmentId !== input.departmentId) {
      throw new AppError(
        'Authority level does not belong to the specified department',
        400,
      );
    }

    // Department membership check: Staff must belong to the department
    const staffMemberships = await staffRepository.findDepartmentsByStaff(
      input.staffUserId,
      true,
    );
    const isMember = staffMemberships.some((m) => m.departmentId === input.departmentId);
    if (!isMember) {
      throw new AppError(
        'Staff member does not have an active appointment in this department',
        400,
      );
    }

    try {
      return await authorityRepository.assignStaff({
        staffUserId: input.staffUserId,
        departmentAuthorityLevelId: input.departmentAuthorityLevelId,
        departmentId: input.departmentId,
        validFrom: input.validFrom ? new Date(input.validFrom) : undefined,
        validTo: input.validTo ? new Date(input.validTo) : undefined,
      });
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'code' in err && err.code === '23P01') {
        throw new AppError(
          'Staff already has an overlapping active authority assignment in this department',
          409,
        );
      }
      throw err;
    }
  }

  /**
   * Ends an active staff authority assignment.
   */
  async endStaffAuthority(
    staffUserId: string,
    departmentId: string,
    validTo?: string,
  ): Promise<StaffAuthorityAssignmentRecord> {
    const ended = await authorityRepository.endStaffAssignment(
      staffUserId,
      departmentId,
      validTo ? new Date(validTo) : undefined,
    );
    if (!ended) {
      throw new AppError(
        'No active authority level assignment found to end for this staff member in this department',
        404,
      );
    }
    return ended;
  }

  /**
   * Retrieves authority assignments for a staff member.
   */
  async getStaffAuthorityAssignments(
    staffUserId: string,
    activeOnly = false,
  ): Promise<StaffAuthorityAssignmentRecord[]> {
    const user = await userRepository.findById(staffUserId);
    if (!user) {
      throw new AppError('User not found', 404);
    }
    return authorityRepository.findStaffAssignments(staffUserId, activeOnly);
  }
}

export const authorityService = new AuthorityService();
