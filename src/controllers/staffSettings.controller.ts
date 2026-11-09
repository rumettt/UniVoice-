import { Request, Response } from 'express';
import { staffSettingsService } from '../services/admin/staffSettings.service';
import {
  assignStaffDepartmentSchema,
  endStaffDepartmentMembershipSchema,
  updateStaffWorkSettingsSchema,
  staffQuerySchema,
} from '../validators/staff.validators';
import { AppError } from '../utils/AppError';

/**
 * POST /api/v1/departments/:departmentId/staff
 * Assign a staff member to a department.
 */
export async function assignStaffToDepartment(req: Request, res: Response): Promise<void> {
  const departmentId = req.params.departmentId as string;
  const parseResult = assignStaffDepartmentSchema.safeParse({
    ...req.body,
    departmentId,
  });
  if (!parseResult.success) {
    const errorMsg = parseResult.error.issues.map((i) => i.message).join(', ');
    throw new AppError(`Validation failed: ${errorMsg}`, 400);
  }

  const membership = await staffSettingsService.assignDepartment(parseResult.data);
  res.status(201).json({
    status: 'success',
    data: { membership },
  });
}

/**
 * DELETE /api/v1/departments/:departmentId/staff/:staffUserId
 * End staff department membership.
 */
export async function endStaffDepartmentMembership(req: Request, res: Response): Promise<void> {
  const departmentId = req.params.departmentId as string;
  const staffUserId = req.params.staffUserId as string;
  const parseResult = endStaffDepartmentMembershipSchema.safeParse(req.body);
  if (!parseResult.success) {
    const errorMsg = parseResult.error.issues.map((i) => i.message).join(', ');
    throw new AppError(`Validation failed: ${errorMsg}`, 400);
  }

  const membership = await staffSettingsService.endDepartmentMembership(
    staffUserId,
    departmentId,
    parseResult.data.validTo,
  );
  res.status(200).json({
    status: 'success',
    data: { membership },
  });
}

/**
 * GET /api/v1/departments/:departmentId/staff
 * List all staff belonging to a department.
 */
export async function getDepartmentStaff(req: Request, res: Response): Promise<void> {
  const departmentId = req.params.departmentId as string;
  const parseResult = staffQuerySchema.safeParse(req.query);
  const activeOnly = parseResult.success ? parseResult.data.isActive ?? false : false;

  const staff = await staffSettingsService.getDepartmentStaff(departmentId, activeOnly);
  res.status(200).json({
    status: 'success',
    data: { staff },
  });
}

/**
 * GET /api/v1/users/:staffUserId/departments
 * List all departments belonging to a staff member.
 */
export async function getStaffDepartments(req: Request, res: Response): Promise<void> {
  const staffUserId = req.params.staffUserId as string;
  const parseResult = staffQuerySchema.safeParse(req.query);
  const activeOnly = parseResult.success ? parseResult.data.isActive ?? false : false;

  const departments = await staffSettingsService.getStaffDepartments(staffUserId, activeOnly);
  res.status(200).json({
    status: 'success',
    data: { departments },
  });
}

/**
 * GET /api/v1/departments/:departmentId/staff/:staffUserId/work-settings
 * Retrieve staff work settings with effective capacity.
 */
export async function getStaffWorkSettings(req: Request, res: Response): Promise<void> {
  const departmentId = req.params.departmentId as string;
  const staffUserId = req.params.staffUserId as string;
  const workSettings = await staffSettingsService.getWorkSettings(staffUserId, departmentId);
  res.status(200).json({
    status: 'success',
    data: { workSettings },
  });
}

/**
 * PATCH /api/v1/departments/:departmentId/staff/:staffUserId/work-settings
 * Update staff availability and capacity override.
 */
export async function updateStaffWorkSettings(req: Request, res: Response): Promise<void> {
  const departmentId = req.params.departmentId as string;
  const staffUserId = req.params.staffUserId as string;
  const parseResult = updateStaffWorkSettingsSchema.safeParse(req.body);
  if (!parseResult.success) {
    const errorMsg = parseResult.error.issues.map((i) => i.message).join(', ');
    throw new AppError(`Validation failed: ${errorMsg}`, 400);
  }

  const workSettings = await staffSettingsService.updateWorkSettings(
    staffUserId,
    departmentId,
    parseResult.data,
  );
  res.status(200).json({
    status: 'success',
    data: { workSettings },
  });
}
