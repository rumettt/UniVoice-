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

// Student-initiated reopening is no longer supported (Phase 7 Milestone 2).
// Students may send messages on closed requests instead.
// Staff (last handler) may reopen via POST /api/v1/staff/requests/:requestId/reopen-closed.
requestRouter.post('/:requestId/reopen', (_req, res) => {
  res.status(410).json({
    status: 'error',
    message:
      'Student-initiated request reopening is no longer available. ' +
      'You may send a message on your closed request instead.',
  });
});

export default requestRouter;
