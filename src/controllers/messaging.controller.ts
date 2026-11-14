import { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { AppError } from '../utils/AppError';
import { messagingService } from '../services/messaging/messaging.service';
import {
  sendMessageSchema,
  staffReplySchema,
  staffReopenFromClosedSchema,
  staffRejectFurtherSchema,
  getMessagesQuerySchema,
} from '../validators/messaging.validators';
import { requestIdParamSchema } from '../validators/request.validators';
import { z } from 'zod';

const attachmentIdParamSchema = z.object({ attachmentId: z.string().uuid('Invalid attachment ID') });

// ---------------------------------------------------------------------------
// Student endpoints
// ---------------------------------------------------------------------------

/**
 * POST /api/v1/requests/:requestId/messages
 * Student sends a message on their own closed request.
 */
export async function studentSendMessage(req: Request, res: Response): Promise<void> {
  if (!req.user) throw new AppError('Authentication required', 401);

  const paramResult = requestIdParamSchema.safeParse(req.params);
  if (!paramResult.success) {
    throw new AppError(`Validation failed: ${paramResult.error.issues.map((i) => i.message).join(', ')}`, 400);
  }

  const bodyResult = sendMessageSchema.safeParse(req.body);
  if (!bodyResult.success) {
    throw new AppError(`Validation failed: ${bodyResult.error.issues.map((i) => i.message).join(', ')}`, 400);
  }

  const comment = await messagingService.studentSendMessage(
    req.user.id,
    paramResult.data.requestId,
    bodyResult.data,
  );

  res.status(201).json({ status: 'success', data: { message: comment } });
}

/**
 * GET /api/v1/requests/:requestId/messages
 * Student retrieves the student-visible conversation on their own closed request.
 */
export async function studentGetConversation(req: Request, res: Response): Promise<void> {
  if (!req.user) throw new AppError('Authentication required', 401);

  const paramResult = requestIdParamSchema.safeParse(req.params);
  if (!paramResult.success) {
    throw new AppError(`Validation failed: ${paramResult.error.issues.map((i) => i.message).join(', ')}`, 400);
  }

  const queryResult = getMessagesQuerySchema.safeParse(req.query);
  if (!queryResult.success) {
    throw new AppError(`Validation failed: ${queryResult.error.issues.map((i) => i.message).join(', ')}`, 400);
  }

  const result = await messagingService.studentGetConversation(
    req.user.id,
    paramResult.data.requestId,
    queryResult.data,
  );

  res.status(200).json({ status: 'success', data: result });
}

/**
 * POST /api/v1/requests/:requestId/messages/attachments
 * Student uploads a file attachment on a closed request.
 */
export async function studentUploadAttachment(req: Request, res: Response): Promise<void> {
  if (!req.user) throw new AppError('Authentication required', 401);

  const paramResult = requestIdParamSchema.safeParse(req.params);
  if (!paramResult.success) {
    throw new AppError(`Validation failed: ${paramResult.error.issues.map((i) => i.message).join(', ')}`, 400);
  }

  if (!req.file) {
    throw new AppError('No file provided', 400);
  }

  const commentId = typeof req.body.commentId === 'string' ? req.body.commentId : null;

  const result = await messagingService.uploadAttachment({
    actorId: req.user.id,
    actorRole: 'student',
    requestId: paramResult.data.requestId,
    commentId,
    buffer: req.file.buffer,
    originalName: req.file.originalname,
    mimeType: req.file.mimetype,
    sizeBytes: req.file.size,
  });

  res.status(201).json({ status: 'success', data: result });
}

// ---------------------------------------------------------------------------
// Staff endpoints
// ---------------------------------------------------------------------------

/**
 * POST /api/v1/staff/requests/:requestId/messages
 * Staff replies to the closed-request conversation.
 */
export async function staffReply(req: Request, res: Response): Promise<void> {
  if (!req.user) throw new AppError('Authentication required', 401);

  const paramResult = requestIdParamSchema.safeParse(req.params);
  if (!paramResult.success) {
    throw new AppError(`Validation failed: ${paramResult.error.issues.map((i) => i.message).join(', ')}`, 400);
  }

  const bodyResult = staffReplySchema.safeParse(req.body);
  if (!bodyResult.success) {
    throw new AppError(`Validation failed: ${bodyResult.error.issues.map((i) => i.message).join(', ')}`, 400);
  }

  const comment = await messagingService.staffReply(
    req.user.id,
    paramResult.data.requestId,
    bodyResult.data,
  );

  res.status(201).json({ status: 'success', data: { message: comment } });
}

/**
 * GET /api/v1/staff/requests/:requestId/messages
 * Staff retrieves the conversation on a request they last handled.
 */
export async function staffGetConversation(req: Request, res: Response): Promise<void> {
  if (!req.user) throw new AppError('Authentication required', 401);

  const paramResult = requestIdParamSchema.safeParse(req.params);
  if (!paramResult.success) {
    throw new AppError(`Validation failed: ${paramResult.error.issues.map((i) => i.message).join(', ')}`, 400);
  }

  const queryResult = getMessagesQuerySchema.safeParse(req.query);
  if (!queryResult.success) {
    throw new AppError(`Validation failed: ${queryResult.error.issues.map((i) => i.message).join(', ')}`, 400);
  }

  const result = await messagingService.staffGetConversation(
    req.user.id,
    paramResult.data.requestId,
    queryResult.data,
  );

  res.status(200).json({ status: 'success', data: result });
}

/**
 * POST /api/v1/staff/requests/:requestId/reopen-closed
 * Staff reopens a closed request and returns it to the authority-level queue.
 */
export async function staffReopenFromClosed(req: Request, res: Response): Promise<void> {
  if (!req.user) throw new AppError('Authentication required', 401);

  const paramResult = requestIdParamSchema.safeParse(req.params);
  if (!paramResult.success) {
    throw new AppError(`Validation failed: ${paramResult.error.issues.map((i) => i.message).join(', ')}`, 400);
  }

  const bodyResult = staffReopenFromClosedSchema.safeParse(req.body);
  if (!bodyResult.success) {
    throw new AppError(`Validation failed: ${bodyResult.error.issues.map((i) => i.message).join(', ')}`, 400);
  }

  const result = await messagingService.staffReopenFromClosed(
    req.user.id,
    paramResult.data.requestId,
    bodyResult.data,
  );

  res.status(200).json({ status: 'success', data: result });
}

/**
 * POST /api/v1/staff/requests/:requestId/reject-further
 * Staff permanently closes further communication on a closed request.
 */
export async function staffRejectFurther(req: Request, res: Response): Promise<void> {
  if (!req.user) throw new AppError('Authentication required', 401);

  const paramResult = requestIdParamSchema.safeParse(req.params);
  if (!paramResult.success) {
    throw new AppError(`Validation failed: ${paramResult.error.issues.map((i) => i.message).join(', ')}`, 400);
  }

  const bodyResult = staffRejectFurtherSchema.safeParse(req.body);
  if (!bodyResult.success) {
    throw new AppError(`Validation failed: ${bodyResult.error.issues.map((i) => i.message).join(', ')}`, 400);
  }

  const comment = await messagingService.staffRejectFurther(
    req.user.id,
    paramResult.data.requestId,
    bodyResult.data,
  );

  res.status(200).json({ status: 'success', data: { message: comment } });
}

/**
 * POST /api/v1/staff/requests/:requestId/messages/attachments
 * Staff uploads a file attachment on a closed request conversation.
 */
export async function staffUploadAttachment(req: Request, res: Response): Promise<void> {
  if (!req.user) throw new AppError('Authentication required', 401);

  const paramResult = requestIdParamSchema.safeParse(req.params);
  if (!paramResult.success) {
    throw new AppError(`Validation failed: ${paramResult.error.issues.map((i) => i.message).join(', ')}`, 400);
  }

  if (!req.file) {
    throw new AppError('No file provided', 400);
  }

  const commentId = typeof req.body.commentId === 'string' ? req.body.commentId : null;

  const result = await messagingService.uploadAttachment({
    actorId: req.user.id,
    actorRole: 'staff',
    requestId: paramResult.data.requestId,
    commentId,
    buffer: req.file.buffer,
    originalName: req.file.originalname,
    mimeType: req.file.mimetype,
    sizeBytes: req.file.size,
  });

  res.status(201).json({ status: 'success', data: result });
}

// ---------------------------------------------------------------------------
// Shared attachment download (student + staff + admin)
// ---------------------------------------------------------------------------

/**
 * GET /api/v1/attachments/:attachmentId
 * Download an authorised attachment.
 * For local storage: streams the file bytes.
 * For S3-compatible storage: redirects to the signed URL.
 */
export async function downloadAttachment(req: Request, res: Response): Promise<void> {
  if (!req.user) throw new AppError('Authentication required', 401);

  const paramResult = attachmentIdParamSchema.safeParse(req.params);
  if (!paramResult.success) {
    throw new AppError(`Validation failed: ${paramResult.error.issues.map((i) => i.message).join(', ')}`, 400);
  }

  const { url, originalName, mimeType } = await messagingService.getAttachmentDownloadUrl(
    req.user.id,
    req.user.role as 'student' | 'staff' | 'admin',
    paramResult.data.attachmentId,
  );

  // Local storage: url is a filesystem path — stream the file
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    const resolvedPath = path.resolve(url);
    // Safety: reject any path not in the uploads directory
    if (!fs.existsSync(resolvedPath)) {
      throw new AppError('Attachment file not found', 404);
    }
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(originalName)}"`);
    if (mimeType) res.setHeader('Content-Type', mimeType);
    const stream = fs.createReadStream(resolvedPath);
    stream.on('error', () => {
      if (!res.headersSent) res.status(500).json({ status: 'error', message: 'Failed to stream file' });
    });
    stream.pipe(res);
    return;
  }

  // Object storage: redirect to presigned URL
  res.redirect(302, url);
}
