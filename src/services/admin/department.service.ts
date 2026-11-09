import {
  departmentRepository,
  DepartmentRecord,
  DepartmentWithMetrics,
} from '../../repositories/department.repository';
import { AppError } from '../../utils/AppError';
import {
  CreateDepartmentInput,
  UpdateDepartmentInput,
  DepartmentQueryInput,
} from '../../validators/department.validators';

export class DepartmentService {
  /**
   * Creates a new department.
   */
  async createDepartment(input: CreateDepartmentInput): Promise<DepartmentRecord> {
    try {
      return await departmentRepository.create(input);
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'code' in err && err.code === '23505') {
        throw new AppError('A department with this name or code already exists', 409);
      }
      throw err;
    }
  }

  /**
   * Retrieves department details including derived metrics.
   */
  async getDepartmentById(id: string): Promise<DepartmentWithMetrics> {
    const department = await departmentRepository.findByIdWithMetrics(id);
    if (!department) {
      throw new AppError('Department not found', 404);
    }
    return department;
  }

  /**
   * Lists departments with pagination and filtering.
   */
  async listDepartments(query: DepartmentQueryInput): Promise<{
    departments: DepartmentRecord[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const { departments, total } = await departmentRepository.findAll(query);
    const totalPages = Math.ceil(total / query.limit) || 1;
    return {
      departments,
      total,
      page: query.page,
      limit: query.limit,
      totalPages,
    };
  }

  /**
   * Updates department details.
   */
  async updateDepartment(
    id: string,
    updates: UpdateDepartmentInput,
  ): Promise<DepartmentRecord> {
    const existing = await departmentRepository.findById(id);
    if (!existing) {
      throw new AppError('Department not found', 404);
    }

    try {
      const updated = await departmentRepository.update(id, updates);
      if (!updated) {
        throw new AppError('Failed to update department', 500);
      }
      return updated;
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'code' in err && err.code === '23505') {
        throw new AppError('A department with this name already exists', 409);
      }
      throw err;
    }
  }

  /**
   * Activates or deactivates a department.
   */
  async setDepartmentStatus(id: string, isActive: boolean): Promise<DepartmentRecord> {
    const existing = await departmentRepository.findById(id);
    if (!existing) {
      throw new AppError('Department not found', 404);
    }

    const updated = await departmentRepository.setStatus(id, isActive);
    if (!updated) {
      throw new AppError('Failed to update department status', 500);
    }
    return updated;
  }
}

export const departmentService = new DepartmentService();
