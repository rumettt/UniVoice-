import { Router } from 'express';
import { authenticate } from '../../middlewares/authenticate';
import { requireRole } from '../../middlewares/authorize';
import { asyncHandler } from '../../utils/asyncHandler';
import {
  getWorkflowSettings,
  updateWorkflowSettings,
} from '../../controllers/systemSettings.controller';

const systemSettingsRouter = Router();

// Administrative settings require authentication and admin role
systemSettingsRouter.use(authenticate, requireRole('admin'));

systemSettingsRouter.get('/request-workflow', asyncHandler(getWorkflowSettings));
systemSettingsRouter.patch('/request-workflow', asyncHandler(updateWorkflowSettings));

export default systemSettingsRouter;
