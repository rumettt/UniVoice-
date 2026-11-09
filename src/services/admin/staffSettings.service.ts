import {
  staffRepository,
  StaffMembershipRecord,
  StaffWorkSettingsRecord,
} from '../../repositories/staff.repository';
import { departmentRepository } from '../../repositories/department.repository';
import { userRepository } from '../../repositories/user.repository';
import { AppError } from '../../utils/AppError';
import {
  AssignStaffDepartmentInput,
  UpdateStaffWorkSettingsInput,
} from '../../validators/staff.validators';

export class StaffSettingsService {
  /**
   * Assigns a staff member to a department.
   */
  async assignDepartment(input: AssignStaffDepartmentInput): Promise<StaffMembershipRecord> {
    const user = await userRepository.findDetailById(input.staffUserId);
    if (!user) {
      throw new AppError('User not found', 404);
    }
    if (user.role !== 'staff' && user.role !== 'admin') {
      throw new AppError('Only staff or admin accounts can be assigned to departments', 400);
    }

    const department = await departmentRepository.findById(input.departmentId);
    if (!department) {
      throw new AppError('Department not found', 404);
    }
    if (!department.isActive) {
      throw new AppError('Cannot assign staff to an inactive department', 400);
    }

    try {
      return await staffRepository.assignDepartment({
        staffUserId: input.staffUserId,
        departmentId: input.departmentId,
        isPrimary: input.isPrimary,
        validFrom: input.validFrom ? new Date(input.validFrom) : undefined,
        validTo: input.validTo ? new Date(input.validTo) : undefined,
      });
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'code' in err && err.code === '23P01') {
        throw new AppError('Staff already has an overlapping active membership in this department', 409);
      }
      throw err;
    }
  }

  /**
   * Ends a staff member's active department appointment.
   */
  async endDepartmentMembership(
    staffUserId: string,
    departmentId: string,
    validTo?: string,
  ): Promise<StaffMembershipRecord> {
    const ended = await staffRepository.endDepartmentMembership(
      staffUserId,
      departmentId,
      validTo ? new Date(validTo) : undefined,
    );
    if (!ended) {
      throw new AppError('No active department membership found to end for this staff member', 404);
    }
    return ended;
  }

  /**
   * Retrieves all departments for a staff member.
   */
  async getStaffDepartments(
    staffUserId: string,
    activeOnly = false,
  ): Promise<StaffMembershipRecord[]> {
    const user = await userRepository.findById(staffUserId);
    if (!user) {
      throw new AppError('User not found', 404);
    }
    return staffRepository.findDepartmentsByStaff(staffUserId, activeOnly);
  }

  /**
   * Retrieves all staff members in a department.
   */
  async getDepartmentStaff(
    departmentId: string,
    activeOnly = false,
  ): Promise<StaffMembershipRecord[]> {
    const department = await departmentRepository.findById(departmentId);
    if (!department) {
      throw new AppError('Department not found', 404);
    }
    return staffRepository.findStaffByDepartment(departmentId, activeOnly);
  }

  /**
   * Retrieves staff work settings and effective capacity for a department.
   */
  async getWorkSettings(
    staffUserId: string,
    departmentId: string,
  ): Promise<StaffWorkSettingsRecord> {
    const department = await departmentRepository.findById(departmentId);
    if (!department) {
      throw new AppError('Department not found', 404);
    }

    const settings = await staffRepository.getWorkSettings(staffUserId, departmentId);
    if (!settings) {
      // Default to available and department capacity limit if not customized yet
      return {
        id: '',
        staffUserId,
        departmentId,
        isAvailable: true,
        maxActiveRequestsOverride: null,
        departmentDefaultMaxActiveRequests: department.defaultMaxActiveRequests,
        effectiveMaxActiveRequests: department.defaultMaxActiveRequests,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    }
    return settings;
  }

  /**
   * Updates staff availability and active request capacity override.
   */
  async updateWorkSettings(
    staffUserId: string,
    departmentId: string,
    input: UpdateStaffWorkSettingsInput,
  ): Promise<StaffWorkSettingsRecord> {
    const department = await departmentRepository.findById(departmentId);
    if (!department) {
      throw new AppError('Department not found', 404);
    }

    const user = await userRepository.findById(staffUserId);
    if (!user) {
      throw new AppError('User not found', 404);
    }

    return staffRepository.upsertWorkSettings({
      staffUserId,
      departmentId,
      isAvailable: input.isAvailable,
      maxActiveRequestsOverride: input.maxActiveRequestsOverride,
    });
  }
}

export const staffSettingsService = new StaffSettingsService();
