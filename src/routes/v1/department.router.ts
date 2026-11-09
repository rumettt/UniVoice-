import { Router } from 'express';
import { authenticate } from '../../middlewares/authenticate';
import { requireAdmin } from '../../middlewares/authorize';
import { asyncHandler } from '../../utils/asyncHandler';
import {
  createDepartment,
  listDepartments,
  getDepartmentById,
  updateDepartment,
  setDepartmentStatus,
} from '../../controllers/department.controller';
import {
  assignStaffToDepartment,
  endStaffDepartmentMembership,
  getDepartmentStaff,
  getStaffWorkSettings,
  updateStaffWorkSettings,
} from '../../controllers/staffSettings.controller';
import {
  createAuthorityLevel,
  getAuthorityLevels,
  updateAuthorityLevel,
  reorderAuthorityLevels,
  assignStaffAuthority,
  endStaffAuthority,
} from '../../controllers/authority.controller';

const departmentRouter = Router();

// Department CRUD & status
departmentRouter.post('/', authenticate, requireAdmin, asyncHandler(createDepartment));
departmentRouter.get('/', authenticate, asyncHandler(listDepartments));
departmentRouter.get('/:id', authenticate, asyncHandler(getDepartmentById));
departmentRouter.patch('/:id', authenticate, requireAdmin, asyncHandler(updateDepartment));
departmentRouter.patch('/:id/status', authenticate, requireAdmin, asyncHandler(setDepartmentStatus));

// Staff department appointments
departmentRouter.post('/:departmentId/staff', authenticate, requireAdmin, asyncHandler(assignStaffToDepartment));
departmentRouter.get('/:departmentId/staff', authenticate, asyncHandler(getDepartmentStaff));
departmentRouter.delete('/:departmentId/staff/:staffUserId', authenticate, requireAdmin, asyncHandler(endStaffDepartmentMembership));

// Staff work settings
departmentRouter.get('/:departmentId/staff/:staffUserId/work-settings', authenticate, asyncHandler(getStaffWorkSettings));
departmentRouter.patch('/:departmentId/staff/:staffUserId/work-settings', authenticate, requireAdmin, asyncHandler(updateStaffWorkSettings));

// Department authority levels
departmentRouter.post('/:departmentId/authority-levels', authenticate, requireAdmin, asyncHandler(createAuthorityLevel));
departmentRouter.get('/:departmentId/authority-levels', authenticate, asyncHandler(getAuthorityLevels));
departmentRouter.put('/:departmentId/authority-levels/reorder', authenticate, requireAdmin, asyncHandler(reorderAuthorityLevels));
departmentRouter.patch('/:departmentId/authority-levels/:id', authenticate, requireAdmin, asyncHandler(updateAuthorityLevel));

// Department staff authority assignments
departmentRouter.post('/:departmentId/authority-levels/assignments', authenticate, requireAdmin, asyncHandler(assignStaffAuthority));
departmentRouter.delete('/:departmentId/authority-levels/assignments/:staffUserId', authenticate, requireAdmin, asyncHandler(endStaffAuthority));

export default departmentRouter;
