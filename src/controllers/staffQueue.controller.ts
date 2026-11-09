import { Request, Response } from 'express';
import { staffQueueService } from '../services/staff/staffQueue.service';
import {
  staffQueueQuerySchema,
  claimRequestParamSchema,
  staffAssignmentsQuerySchema,
} from '../validators/staffQueue.validators';
import { AppError } from '../utils/AppError';

/**
 * GET /api/v1/staff/queue
 * List requests that the authenticated staff member is currently eligible to claim.
 */
export async function getQueue(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    throw new AppError('Authentication required', 401);
  }

  const parseResult = staffQueueQuerySchema.safeParse(req.query);
  if (!parseResult.success) {
    const errorMsg = parseResult.error.issues.map((i) => i.message).join(', ');
    throw new AppError(`Validation failed: ${errorMsg}`, 400);
  }

  const result = await staffQueueService.getEligibleQueue(
    req.user.id,
    parseResult.data,
  );

  res.status(200).json({
    status: 'success',
    data: result,
  });
}

/**
 * GET /api/v1/staff/queue/:requestId
 * Inspect single eligible queue item before claiming.
 */
export async function getQueueItem(
  req: Request,
  res: Response,
): Promise<void> {
  if (!req.user) {
    throw new AppError('Authentication required', 401);
  }

  const parseResult = claimRequestParamSchema.safeParse(req.params);
  if (!parseResult.success) {
    const errorMsg = parseResult.error.issues.map((i) => i.message).join(', ');
    throw new AppError(`Validation failed: ${errorMsg}`, 400);
  }

  const request = await staffQueueService.getQueueItemDetails(
    req.user.id,
    parseResult.data.requestId,
  );

  res.status(200).json({
    status: 'success',
    data: { request },
  });
}

/**
 * POST /api/v1/staff/requests/:requestId/claim
 * Atomically claim an eligible request for the authenticated staff member.
 */
export async function claimRequest(
  req: Request,
  res: Response,
): Promise<void> {
  if (!req.user) {
    throw new AppError('Authentication required', 401);
  }

  const parseResult = claimRequestParamSchema.safeParse(req.params);
  if (!parseResult.success) {
    const errorMsg = parseResult.error.issues.map((i) => i.message).join(', ');
    throw new AppError(`Validation failed: ${errorMsg}`, 400);
  }

  const result = await staffQueueService.claimRequest(
    req.user.id,
    parseResult.data.requestId,
  );

  res.status(200).json({
    status: 'success',
    data: result,
  });
}

/**
 * GET /api/v1/staff/requests/me
 * List requests currently actively assigned to the authenticated staff member.
 */
export async function getMyAssignments(
  req: Request,
  res: Response,
): Promise<void> {
  if (!req.user) {
    throw new AppError('Authentication required', 401);
  }

  const parseResult = staffAssignmentsQuerySchema.safeParse(req.query);
  if (!parseResult.success) {
    const errorMsg = parseResult.error.issues.map((i) => i.message).join(', ');
    throw new AppError(`Validation failed: ${errorMsg}`, 400);
  }

  const result = await staffQueueService.getMyAssignedRequests(
    req.user.id,
    parseResult.data,
  );

  res.status(200).json({
    status: 'success',
    data: result,
  });
}
