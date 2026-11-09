import { Request, Response } from 'express';
import { categoryService } from '../services/admin/category.service';
import {
  createCategorySchema,
  updateCategorySchema,
  setCategoryStatusSchema,
  categoryQuerySchema,
} from '../validators/category.validators';
import { AppError } from '../utils/AppError';

/**
 * POST /api/v1/categories
 * Create a new category.
 */
export async function createCategory(req: Request, res: Response): Promise<void> {
  const parseResult = createCategorySchema.safeParse(req.body);
  if (!parseResult.success) {
    const errorMsg = parseResult.error.issues.map((i) => i.message).join(', ');
    throw new AppError(`Validation failed: ${errorMsg}`, 400);
  }

  const category = await categoryService.createCategory(parseResult.data);
  res.status(201).json({
    status: 'success',
    data: { category },
  });
}

/**
 * GET /api/v1/categories
 * List categories.
 * Clarification 4: Non-admin users are restricted to active categories.
 */
export async function listCategories(req: Request, res: Response): Promise<void> {
  const parseResult = categoryQuerySchema.safeParse(req.query);
  if (!parseResult.success) {
    const errorMsg = parseResult.error.issues.map((i) => i.message).join(', ');
    throw new AppError(`Validation failed: ${errorMsg}`, 400);
  }

  const query = { ...parseResult.data };

  // If user is not an admin, force isActive = true so only active categories are visible
  if (req.user?.role !== 'admin') {
    query.isActive = true;
  }

  const result = await categoryService.listCategories(query);
  res.status(200).json({
    status: 'success',
    data: result,
  });
}

/**
 * GET /api/v1/categories/:id
 * Retrieve single category details.
 */
export async function getCategoryById(req: Request, res: Response): Promise<void> {
  const id = req.params.id as string;
  const category = await categoryService.getCategoryById(id);

  // If user is not admin and category is inactive, return 404
  if (req.user?.role !== 'admin' && !category.isActive) {
    throw new AppError('Category not found', 404);
  }

  res.status(200).json({
    status: 'success',
    data: { category },
  });
}

/**
 * PATCH /api/v1/categories/:id
 * Update category information and routing target.
 */
export async function updateCategory(req: Request, res: Response): Promise<void> {
  const id = req.params.id as string;
  const parseResult = updateCategorySchema.safeParse(req.body);
  if (!parseResult.success) {
    const errorMsg = parseResult.error.issues.map((i) => i.message).join(', ');
    throw new AppError(`Validation failed: ${errorMsg}`, 400);
  }

  const category = await categoryService.updateCategory(id, parseResult.data);
  res.status(200).json({
    status: 'success',
    data: { category },
  });
}

/**
 * PATCH /api/v1/categories/:id/status
 * Activate or deactivate a category.
 */
export async function setCategoryStatus(req: Request, res: Response): Promise<void> {
  const id = req.params.id as string;
  const parseResult = setCategoryStatusSchema.safeParse(req.body);
  if (!parseResult.success) {
    const errorMsg = parseResult.error.issues.map((i) => i.message).join(', ');
    throw new AppError(`Validation failed: ${errorMsg}`, 400);
  }

  const category = await categoryService.setCategoryStatus(id, parseResult.data.isActive);
  res.status(200).json({
    status: 'success',
    data: { category },
  });
}
