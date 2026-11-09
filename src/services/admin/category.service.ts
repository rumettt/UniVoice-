import {
  categoryRepository,
  CategoryRecord,
  CategoryFilter,
} from '../../repositories/category.repository';
import { departmentRepository } from '../../repositories/department.repository';
import { authorityRepository } from '../../repositories/authority.repository';
import { AppError } from '../../utils/AppError';
import {
  CreateCategoryInput,
  UpdateCategoryInput,
} from '../../validators/category.validators';

export class CategoryService {
  /**
   * Creates a new category.
   * Validates that the configured initial authority level belongs to the specified department.
   */
  async createCategory(input: CreateCategoryInput): Promise<CategoryRecord> {
    const department = await departmentRepository.findById(input.departmentId);
    if (!department) {
      throw new AppError('Department not found', 404);
    }
    if (!department.isActive) {
      throw new AppError('Cannot create category for an inactive department', 400);
    }

    const authorityLevel = await authorityRepository.findById(input.initialAuthorityLevelId);
    if (!authorityLevel) {
      throw new AppError('Initial authority level not found', 404);
    }
    if (authorityLevel.departmentId !== input.departmentId) {
      throw new AppError(
        'The configured initial authority level must belong to the specified department',
        400,
      );
    }
    if (!authorityLevel.isActive) {
      throw new AppError('Cannot assign an inactive authority level as initial queue', 400);
    }

    try {
      return await categoryRepository.create(input);
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'code' in err && err.code === '23505') {
        throw new AppError('A category with this name already exists in this department', 409);
      }
      throw err;
    }
  }

  /**
   * Retrieves category by ID.
   */
  async getCategoryById(id: string): Promise<CategoryRecord> {
    const category = await categoryRepository.findById(id);
    if (!category) {
      throw new AppError('Category not found', 404);
    }
    return category;
  }

  /**
   * Lists categories with pagination and filtering.
   * Clarification 4: Distinguishes active from inactive categories.
   */
  async listCategories(filters: CategoryFilter): Promise<{
    categories: CategoryRecord[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const { categories, total } = await categoryRepository.findAll(filters);
    const totalPages = Math.ceil(total / filters.limit) || 1;
    return {
      categories,
      total,
      page: filters.page,
      limit: filters.limit,
      totalPages,
    };
  }

  /**
   * Updates category information.
   * Validates authority level consistency if department or level is modified.
   */
  async updateCategory(id: string, updates: UpdateCategoryInput): Promise<CategoryRecord> {
    const existing = await categoryRepository.findById(id);
    if (!existing) {
      throw new AppError('Category not found', 404);
    }

    const targetDeptId = updates.departmentId ?? existing.departmentId;
    const targetLevelId = updates.initialAuthorityLevelId ?? existing.initialAuthorityLevelId;

    if (updates.departmentId || updates.initialAuthorityLevelId) {
      const dept = await departmentRepository.findById(targetDeptId);
      if (!dept) {
        throw new AppError('Target department not found', 404);
      }

      const level = await authorityRepository.findById(targetLevelId);
      if (!level) {
        throw new AppError('Target authority level not found', 404);
      }

      if (level.departmentId !== targetDeptId) {
        throw new AppError(
          'Configured initial authority level must belong to the associated department',
          400,
        );
      }
    }

    try {
      const updated = await categoryRepository.update(id, updates);
      if (!updated) {
        throw new AppError('Failed to update category', 500);
      }
      return updated;
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'code' in err && err.code === '23505') {
        throw new AppError('A category with this name already exists in this department', 409);
      }
      throw err;
    }
  }

  /**
   * Toggles category active status.
   */
  async setCategoryStatus(id: string, isActive: boolean): Promise<CategoryRecord> {
    const existing = await categoryRepository.findById(id);
    if (!existing) {
      throw new AppError('Category not found', 404);
    }

    const updated = await categoryRepository.setStatus(id, isActive);
    if (!updated) {
      throw new AppError('Failed to update category status', 500);
    }
    return updated;
  }
}

export const categoryService = new CategoryService();
