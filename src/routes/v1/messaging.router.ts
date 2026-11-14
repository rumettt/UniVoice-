import { Router } from 'express';
import { authenticate } from '../../middlewares/authenticate';
import { requireRole } from '../../middlewares/authorize';
import { asyncHandler } from '../../utils/asyncHandler';
import { uploadMiddleware } from '../../middlewares/upload';
import {
  studentSendMessage,
  studentGetConversation,
  studentUploadAttachment,
  staffReply,
  staffGetConversation,
  staffReopenFromClosed,
  staffRejectFurther,
  staffUploadAttachment,
  downloadAttachment,
} from '../../controllers/messaging.controller';

const messagingRouter = Router();

// ---------------------------------------------------------------------------
// Student messaging endpoints — mounted under /api/v1/requests
// ---------------------------------------------------------------------------

// POST /api/v1/requests/:requestId/messages
messagingRouter.post(
  '/:requestId/messages',
  authenticate,
  requireRole('student'),
  asyncHandler(studentSendMessage),
);

// GET /api/v1/requests/:requestId/messages
messagingRouter.get(
  '/:requestId/messages',
  authenticate,
  requireRole('student'),
  asyncHandler(studentGetConversation),
);

// POST /api/v1/requests/:requestId/messages/attachments
messagingRouter.post(
  '/:requestId/messages/attachments',
  authenticate,
  requireRole('student'),
  uploadMiddleware.single('file'),
  asyncHandler(studentUploadAttachment),
);

export { messagingRouter };

// ---------------------------------------------------------------------------
// Staff messaging endpoints — mounted under /api/v1/staff/requests
// ---------------------------------------------------------------------------

const staffMessagingRouter = Router();

// POST /api/v1/staff/requests/:requestId/messages
staffMessagingRouter.post(
  '/:requestId/messages',
  authenticate,
  requireRole('staff'),
  asyncHandler(staffReply),
);

// GET /api/v1/staff/requests/:requestId/messages
staffMessagingRouter.get(
  '/:requestId/messages',
  authenticate,
  requireRole('staff'),
  asyncHandler(staffGetConversation),
);

// POST /api/v1/staff/requests/:requestId/reopen-closed
staffMessagingRouter.post(
  '/:requestId/reopen-closed',
  authenticate,
  requireRole('staff'),
  asyncHandler(staffReopenFromClosed),
);

// POST /api/v1/staff/requests/:requestId/reject-further
staffMessagingRouter.post(
  '/:requestId/reject-further',
  authenticate,
  requireRole('staff'),
  asyncHandler(staffRejectFurther),
);

// POST /api/v1/staff/requests/:requestId/messages/attachments
staffMessagingRouter.post(
  '/:requestId/messages/attachments',
  authenticate,
  requireRole('staff'),
  uploadMiddleware.single('file'),
  asyncHandler(staffUploadAttachment),
);

export { staffMessagingRouter };

// ---------------------------------------------------------------------------
// Shared attachment download — mounted under /api/v1/attachments
// ---------------------------------------------------------------------------

const attachmentRouter = Router();

// GET /api/v1/attachments/:attachmentId
attachmentRouter.get(
  '/:attachmentId',
  authenticate,
  asyncHandler(downloadAttachment),
);

export { attachmentRouter };
