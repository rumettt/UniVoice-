import { userRepository, UserDetailRecord } from '../../repositories/user.repository';
import { departmentRepository } from '../../repositories/department.repository';
import { hashPassword } from '../auth/password.service';
import { AppError } from '../../utils/AppError';
import {
  CreateUserInput,
  UpdateUserProfileInput,
  UserQueryInput,
} from '../../validators/user.validators';

export class UserManagementService {
  /**
   * Creates a new user (student, staff, or admin) inside an atomic transaction.
   */
  async createUser(input: CreateUserInput): Promise<UserDetailRecord> {
    const existingUser = await userRepository.findByEmail(input.email);
    if (existingUser) {
      throw new AppError('A user with this email address already exists', 409);
    }

    const passwordHash = await hashPassword(input.password);

    if (input.role === 'student') {
      return userRepository.createStudent({
        firstName: input.firstName,
        lastName: input.lastName,
        email: input.email,
        phone: input.phone,
        passwordHash,
        studentNumber: input.studentNumber,
        programName: input.programName,
        profileImageUrl: input.profileImageUrl,
      });
    }

    if (input.role === 'staff') {
      const department = await departmentRepository.findById(input.primaryDepartmentId);
      if (!department) {
        throw new AppError('Specified primary department does not exist', 404);
      }
      if (!department.isActive) {
        throw new AppError('Cannot assign staff to an inactive department', 400);
      }

      return userRepository.createStaff({
        firstName: input.firstName,
        lastName: input.lastName,
        email: input.email,
        phone: input.phone,
        passwordHash,
        employeeNumber: input.employeeNumber,
        primaryDepartmentId: input.primaryDepartmentId,
        currentPositionId: input.currentPositionId,
        profileImageUrl: input.profileImageUrl,
      });
    }

    if (input.role === 'admin') {
      if (input.primaryDepartmentId) {
        const department = await departmentRepository.findById(input.primaryDepartmentId);
        if (!department) {
          throw new AppError('Specified primary department does not exist', 404);
        }
      }

      return userRepository.createAdmin({
        firstName: input.firstName,
        lastName: input.lastName,
        email: input.email,
        phone: input.phone,
        passwordHash,
        primaryDepartmentId: input.primaryDepartmentId,
        employeeNumber: input.employeeNumber,
        currentPositionId: input.currentPositionId,
        profileImageUrl: input.profileImageUrl,
      });
    }

    throw new AppError('Unsupported user role', 400);
  }

  /**
   * Retrieves user details by ID.
   */
  async getUserById(id: string): Promise<UserDetailRecord> {
    const user = await userRepository.findDetailById(id);
    if (!user) {
      throw new AppError('User not found', 404);
    }
    return user;
  }

  /**
   * Lists users with filtering and pagination.
   */
  async listUsers(query: UserQueryInput): Promise<{
    users: UserDetailRecord[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const { users, total } = await userRepository.findAll(query);
    const totalPages = Math.ceil(total / query.limit) || 1;
    return {
      users,
      total,
      page: query.page,
      limit: query.limit,
      totalPages,
    };
  }

  /**
   * Updates user profile attributes.
   */
  async updateUserProfile(
    id: string,
    updates: UpdateUserProfileInput,
  ): Promise<UserDetailRecord> {
    const existing = await userRepository.findById(id);
    if (!existing) {
      throw new AppError('User not found', 404);
    }

    const updated = await userRepository.updateProfile(id, updates);
    if (!updated) {
      throw new AppError('Failed to update user profile', 500);
    }
    return updated;
  }

  /**
   * Activates or deactivates a user account.
   */
  async setUserStatus(
    id: string,
    isActive: boolean,
    currentAdminId: string,
  ): Promise<UserDetailRecord> {
    if (id === currentAdminId && !isActive) {
      throw new AppError('Administrators cannot deactivate their own account', 400);
    }

    const existing = await userRepository.findById(id);
    if (!existing) {
      throw new AppError('User not found', 404);
    }

    const updated = await userRepository.setStatus(id, isActive);
    if (!updated) {
      throw new AppError('Failed to update user status', 500);
    }
    return updated;
  }
}

export const userManagementService = new UserManagementService();
