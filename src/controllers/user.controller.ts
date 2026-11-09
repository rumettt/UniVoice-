import { Request, Response } from 'express';
import { userManagementService } from '../services/admin/userManagement.service';
import {
  createUserSchema,
  updateUserProfileSchema,
  setUserStatusSchema,
  userQuerySchema,
} from '../validators/user.validators';
import { AppError } from '../utils/AppError';

/**
 * POST /api/v1/users
 * Administrative user creation for students, staff, and admins.
 */
export async function createUser(req: Request, res: Response): Promise<void> {
  const parseResult = createUserSchema.safeParse(req.body);
  if (!parseResult.success) {
    const errorMsg = parseResult.error.issues.map((i) => i.message).join(', ');
    throw new AppError(`Validation failed: ${errorMsg}`, 400);
  }

  const user = await userManagementService.createUser(parseResult.data);
  res.status(201).json({
    status: 'success',
    data: { user },
  });
}

/**
 * GET /api/v1/users
 * Administrative listing with pagination and filters.
 */
export async function listUsers(req: Request, res: Response): Promise<void> {
  const parseResult = userQuerySchema.safeParse(req.query);
  if (!parseResult.success) {
    const errorMsg = parseResult.error.issues.map((i) => i.message).join(', ');
    throw new AppError(`Validation failed: ${errorMsg}`, 400);
  }

  const result = await userManagementService.listUsers(parseResult.data);
  res.status(200).json({
    status: 'success',
    data: result,
  });
}

/**
 * GET /api/v1/users/:id
 * Retrieve details for a single user.
 */
export async function getUserById(req: Request, res: Response): Promise<void> {
  const id = req.params.id as string;
  const user = await userManagementService.getUserById(id);
  res.status(200).json({
    status: 'success',
    data: { user },
  });
}

/**
 * PATCH /api/v1/users/:id/profile
 * Update profile information for a user.
 */
export async function updateUserProfile(req: Request, res: Response): Promise<void> {
  const id = req.params.id as string;
  const parseResult = updateUserProfileSchema.safeParse(req.body);
  if (!parseResult.success) {
    const errorMsg = parseResult.error.issues.map((i) => i.message).join(', ');
    throw new AppError(`Validation failed: ${errorMsg}`, 400);
  }

  const user = await userManagementService.updateUserProfile(id, parseResult.data);
  res.status(200).json({
    status: 'success',
    data: { user },
  });
}

/**
 * PATCH /api/v1/users/:id/status
 * Activate or deactivate a user account.
 */
export async function setUserStatus(req: Request, res: Response): Promise<void> {
  const id = req.params.id as string;
  const parseResult = setUserStatusSchema.safeParse(req.body);
  if (!parseResult.success) {
    const errorMsg = parseResult.error.issues.map((i) => i.message).join(', ');
    throw new AppError(`Validation failed: ${errorMsg}`, 400);
  }

  const currentAdminId = req.user!.id;
  const user = await userManagementService.setUserStatus(
    id,
    parseResult.data.isActive,
    currentAdminId,
  );
  res.status(200).json({
    status: 'success',
    data: { user },
  });
}
