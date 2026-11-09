import { Router } from 'express';
import { authenticate } from '../../middlewares/authenticate';
import { requireRole } from '../../middlewares/authorize';
import { asyncHandler } from '../../utils/asyncHandler';
import {
  submitRequest,
  getMyRequests,
  getRequestById,
} from '../../controllers/request.controller';

const requestRouter = Router();

// Student-only request management endpoints
requestRouter.post(
  '/',
  authenticate,
  requireRole('student'),
  asyncHandler(submitRequest),
);

requestRouter.get(
  '/me',
  authenticate,
  requireRole('student'),
  asyncHandler(getMyRequests),
);

requestRouter.get(
  '/:requestId',
  authenticate,
  requireRole('student'),
  asyncHandler(getRequestById),
);

export default requestRouter;
