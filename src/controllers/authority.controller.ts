import { Request, Response } from 'express';
import { authorityService } from '../services/admin/authority.service';
import {
  createAuthorityLevelSchema,
  updateAuthorityLevelSchema,
  reorderAuthorityLevelsSchema,
  assignStaffAuthorityLevelSchema,
  endStaffAuthorityLevelSchema,
} from '../validators/authority.validators';
import { AppError } from '../utils/AppError';

/**
 * POST /api/v1/departments/:departmentId/authority-levels
 * Create authority level in a department.
 */
export async function createAuthorityLevel(req: Request, res: Response): Promise<void> {
  const departmentId = req.params.departmentId as string;
  const parseResult = createAuthorityLevelSchema.safeParse({
    ...req.body,
    departmentId,
  });
  if (!parseResult.success) {
    const errorMsg = parseResult.error.issues.map((i) => i.message).join(', ');
    throw new AppError(`Validation failed: ${errorMsg}`, 400);
  }

  const authorityLevel = await authorityService.createAuthorityLevel(parseResult.data);
  res.status(201).json({
    status: 'success',
    data: { authorityLevel },
  });
}

/**
 * GET /api/v1/departments/:departmentId/authority-levels
 * List all authority levels in a department.
 */
export async function getAuthorityLevels(req: Request, res: Response): Promise<void> {
  const departmentId = req.params.departmentId as string;
  const activeOnly = req.query.isActive === 'true';

  const authorityLevels = await authorityService.getAuthorityLevels(departmentId, activeOnly);
  res.status(200).json({
    status: 'success',
    data: { authorityLevels },
  });
}

/**
 * PATCH /api/v1/departments/:departmentId/authority-levels/:id
 * Update an authority level.
 */
export async function updateAuthorityLevel(req: Request, res: Response): Promise<void> {
  const id = req.params.id as string;
  const parseResult = updateAuthorityLevelSchema.safeParse(req.body);
  if (!parseResult.success) {
    const errorMsg = parseResult.error.issues.map((i) => i.message).join(', ');
    throw new AppError(`Validation failed: ${errorMsg}`, 400);
  }

  const authorityLevel = await authorityService.updateAuthorityLevel(id, parseResult.data);
  res.status(200).json({
    status: 'success',
    data: { authorityLevel },
  });
}

/**
 * PUT /api/v1/departments/:departmentId/authority-levels/reorder
 * Reorder authority levels safely.
 */
export async function reorderAuthorityLevels(req: Request, res: Response): Promise<void> {
  const departmentId = req.params.departmentId as string;
  const parseResult = reorderAuthorityLevelsSchema.safeParse({
    ...req.body,
    departmentId,
  });
  if (!parseResult.success) {
    const errorMsg = parseResult.error.issues.map((i) => i.message).join(', ');
    throw new AppError(`Validation failed: ${errorMsg}`, 400);
  }

  const authorityLevels = await authorityService.reorderAuthorityLevels(parseResult.data);
  res.status(200).json({
    status: 'success',
    data: { authorityLevels },
  });
}

/**
 * POST /api/v1/departments/:departmentId/authority-levels/assignments
 * Assign staff member to an authority level.
 */
export async function assignStaffAuthority(req: Request, res: Response): Promise<void> {
  const departmentId = req.params.departmentId as string;
  const parseResult = assignStaffAuthorityLevelSchema.safeParse({
    ...req.body,
    departmentId,
  });
  if (!parseResult.success) {
    const errorMsg = parseResult.error.issues.map((i) => i.message).join(', ');
    throw new AppError(`Validation failed: ${errorMsg}`, 400);
  }

  const assignment = await authorityService.assignStaffAuthority(parseResult.data);
  res.status(201).json({
    status: 'success',
    data: { assignment },
  });
}

/**
 * DELETE /api/v1/departments/:departmentId/authority-levels/assignments/:staffUserId
 * End active authority assignment for a staff member in a department.
 */
export async function endStaffAuthority(req: Request, res: Response): Promise<void> {
  const departmentId = req.params.departmentId as string;
  const staffUserId = req.params.staffUserId as string;
  const parseResult = endStaffAuthorityLevelSchema.safeParse(req.body);
  if (!parseResult.success) {
    const errorMsg = parseResult.error.issues.map((i) => i.message).join(', ');
    throw new AppError(`Validation failed: ${errorMsg}`, 400);
  }

  const assignment = await authorityService.endStaffAuthority(
    staffUserId,
    departmentId,
    parseResult.data.validTo,
  );
  res.status(200).json({
    status: 'success',
    data: { assignment },
  });
}

/**
 * GET /api/v1/users/:staffUserId/authority-assignments
 * List authority assignments for a staff member across departments.
 */
export async function getStaffAuthorityAssignments(req: Request, res: Response): Promise<void> {
  const staffUserId = req.params.staffUserId as string;
  const activeOnly = req.query.isActive === 'true';

  const assignments = await authorityService.getStaffAuthorityAssignments(
    staffUserId,
    activeOnly,
  );
  res.status(200).json({
    status: 'success',
    data: { assignments },
  });
}
