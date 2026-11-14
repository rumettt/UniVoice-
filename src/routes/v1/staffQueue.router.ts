import { Router } from 'express';
import { authenticate } from '../../middlewares/authenticate';
import { requireRole } from '../../middlewares/authorize';
import { asyncHandler } from '../../utils/asyncHandler';
import {
  getQueue,
  getQueueItem,
  claimRequest,
  getMyAssignments,
} from '../../controllers/staffQueue.controller';
import {
  startProcessing,
  resolveRequest,
  rejectRequest,
  returnRequest,
  escalateRequest,
} from '../../controllers/staffWorkflow.controller';

const staffQueueRouter = Router();

// All staff endpoints require authentication and staff-role authorization
staffQueueRouter.use(authenticate, requireRole('staff'));

// Queue discovery and inspection endpoints
staffQueueRouter.get('/queue', asyncHandler(getQueue));
staffQueueRouter.get('/queue/:requestId', asyncHandler(getQueueItem));

// Staff assigned requests and claiming endpoints
staffQueueRouter.get('/requests/me', asyncHandler(getMyAssignments));
staffQueueRouter.post('/requests/:requestId/claim', asyncHandler(claimRequest));

// Staff workflow processing endpoints (Phase 6 & Phase 7)
staffQueueRouter.patch('/requests/:requestId/start', asyncHandler(startProcessing));
staffQueueRouter.post('/requests/:requestId/resolve', asyncHandler(resolveRequest));
staffQueueRouter.post('/requests/:requestId/reject', asyncHandler(rejectRequest));
staffQueueRouter.post('/requests/:requestId/return', asyncHandler(returnRequest));
staffQueueRouter.post('/requests/:requestId/escalate', asyncHandler(escalateRequest));

export default staffQueueRouter;
