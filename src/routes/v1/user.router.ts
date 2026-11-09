import { Router } from 'express';
import { authenticate } from '../../middlewares/authenticate';
import { requireAdmin } from '../../middlewares/authorize';
import { asyncHandler } from '../../utils/asyncHandler';
import {
  createUser,
  listUsers,
  getUserById,
  updateUserProfile,
  setUserStatus,
} from '../../controllers/user.controller';
import { getStaffDepartments } from '../../controllers/staffSettings.controller';
import { getStaffAuthorityAssignments } from '../../controllers/authority.controller';

const userRouter = Router();

// Administrative user management
userRouter.post('/', authenticate, requireAdmin, asyncHandler(createUser));
userRouter.get('/', authenticate, requireAdmin, asyncHandler(listUsers));
userRouter.get('/:id', authenticate, requireAdmin, asyncHandler(getUserById));
userRouter.patch('/:id/profile', authenticate, requireAdmin, asyncHandler(updateUserProfile));
userRouter.patch('/:id/status', authenticate, requireAdmin, asyncHandler(setUserStatus));

// Staff membership & authority inspect endpoints
userRouter.get('/:staffUserId/departments', authenticate, asyncHandler(getStaffDepartments));
userRouter.get('/:staffUserId/authority-assignments', authenticate, asyncHandler(getStaffAuthorityAssignments));

export default userRouter;
