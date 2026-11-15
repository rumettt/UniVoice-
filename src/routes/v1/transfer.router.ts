import { Router } from 'express';
import { authenticate } from '../../middlewares/authenticate';
import { requireRole } from '../../middlewares/authorize';
import { asyncHandler } from '../../utils/asyncHandler';
import {
  initiateTransfer,
  getRequestTransfers,
  getPendingTransfers,
  acceptTransfer,
  rejectTransfer,
} from '../../controllers/transfer.controller';

const transferRouter = Router();

// Staff endpoints for transfer discovery and decisions
transferRouter.get(
  '/transfers/pending',
  authenticate,
  requireRole('staff', 'admin'),
  asyncHandler(getPendingTransfers),
);

transferRouter.post(
  '/transfers/:transferId/accept',
  authenticate,
  requireRole('staff', 'admin'),
  asyncHandler(acceptTransfer),
);

transferRouter.post(
  '/transfers/:transferId/reject',
  authenticate,
  requireRole('staff', 'admin'),
  asyncHandler(rejectTransfer),
);

// Staff endpoints for initiating and viewing request transfers
transferRouter.post(
  '/requests/:requestId/transfers',
  authenticate,
  requireRole('staff', 'admin'),
  asyncHandler(initiateTransfer),
);

transferRouter.get(
  '/requests/:requestId/transfers',
  authenticate,
  requireRole('staff', 'admin'),
  asyncHandler(getRequestTransfers),
);

export { transferRouter };

// Admin monitoring router
const adminTransferRouter = Router();

adminTransferRouter.get(
  '/',
  authenticate,
  requireRole('admin'),
  asyncHandler(getPendingTransfers),
);

export { adminTransferRouter };
