import { Request, Response } from 'express';
import { departmentService } from '../services/admin/department.service';
import {
  createDepartmentSchema,
  updateDepartmentSchema,
  setDepartmentStatusSchema,
  departmentQuerySchema,
} from '../validators/department.validators';
import { AppError } from '../utils/AppError';

/**
 * POST /api/v1/departments
 * Create a new department.
 */
export async function createDepartment(req: Request, res: Response): Promise<void> {
  const parseResult = createDepartmentSchema.safeParse(req.body);
  if (!parseResult.success) {
    const errorMsg = parseResult.error.issues.map((i) => i.message).join(', ');
    throw new AppError(`Validation failed: ${errorMsg}`, 400);
  }

  const department = await departmentService.createDepartment(parseResult.data);
  res.status(201).json({
    status: 'success',
    data: { department },
  });
}

/**
 * GET /api/v1/departments
 * Retrieve list of departments with pagination.
 */
export async function listDepartments(req: Request, res: Response): Promise<void> {
  const parseResult = departmentQuerySchema.safeParse(req.query);
  if (!parseResult.success) {
    const errorMsg = parseResult.error.issues.map((i) => i.message).join(', ');
    throw new AppError(`Validation failed: ${errorMsg}`, 400);
  }

  const result = await departmentService.listDepartments(parseResult.data);
  res.status(200).json({
    status: 'success',
    data: result,
  });
}

/**
 * GET /api/v1/departments/:id
 * Retrieve department details with derived metrics.
 */
export async function getDepartmentById(req: Request, res: Response): Promise<void> {
  const id = req.params.id as string;
  const department = await departmentService.getDepartmentById(id);
  res.status(200).json({
    status: 'success',
    data: { department },
  });
}

/**
 * PATCH /api/v1/departments/:id
 * Update department information.
 */
export async function updateDepartment(req: Request, res: Response): Promise<void> {
  const id = req.params.id as string;
  const parseResult = updateDepartmentSchema.safeParse(req.body);
  if (!parseResult.success) {
    const errorMsg = parseResult.error.issues.map((i) => i.message).join(', ');
    throw new AppError(`Validation failed: ${errorMsg}`, 400);
  }

  const department = await departmentService.updateDepartment(id, parseResult.data);
  res.status(200).json({
    status: 'success',
    data: { department },
  });
}

/**
 * PATCH /api/v1/departments/:id/status
 * Activate or deactivate a department.
 */
export async function setDepartmentStatus(req: Request, res: Response): Promise<void> {
  const id = req.params.id as string;
  const parseResult = setDepartmentStatusSchema.safeParse(req.body);
  if (!parseResult.success) {
    const errorMsg = parseResult.error.issues.map((i) => i.message).join(', ');
    throw new AppError(`Validation failed: ${errorMsg}`, 400);
  }

  const department = await departmentService.setDepartmentStatus(id, parseResult.data.isActive);
  res.status(200).json({
    status: 'success',
    data: { department },
  });
}
