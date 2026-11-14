import { Request, Response } from 'express';
import { staffWorkflowService } from '../services/staff/staffWorkflow.service';
import { requestIdParamSchema } from '../validators/request.validators';
import {
  resolveRequestSchema,
  rejectRequestSchema,
  returnRequestSchema,
  escalateRequestSchema,
} from '../validators/requestWorkflow.validators';
import { AppError } from '../utils/AppError';

/**
 * PATCH /api/v1/staff/requests/:requestId/start
 * Starts processing a claimed request (assigned -> in_progress).
 */
export async function startProcessing(req: Request, res: Response): Promise<void> {
  const staffUserId = req.user!.id;
  const paramResult = requestIdParamSchema.safeParse(req.params);
  if (!paramResult.success) {
    const errorMsg = paramResult.error.issues.map((i) => i.message).join(', ');
    throw new AppError(`Validation failed: ${errorMsg}`, 400);
  }

  const updatedRequest = await staffWorkflowService.startProcessing(
    staffUserId,
    paramResult.data.requestId,
  );

  res.status(200).json({
    status: 'success',
    data: { request: updatedRequest },
  });
}

/**
 * POST /api/v1/staff/requests/:requestId/resolve
 * Resolves an in-progress request (in_progress -> resolved -> closed).
 */
export async function resolveRequest(req: Request, res: Response): Promise<void> {
  const staffUserId = req.user!.id;
  const paramResult = requestIdParamSchema.safeParse(req.params);
  if (!paramResult.success) {
    const errorMsg = paramResult.error.issues.map((i) => i.message).join(', ');
    throw new AppError(`Validation failed: ${errorMsg}`, 400);
  }

  const bodyResult = resolveRequestSchema.safeParse(req.body);
  if (!bodyResult.success) {
    const errorMsg = bodyResult.error.issues.map((i) => i.message).join(', ');
    throw new AppError(`Validation failed: ${errorMsg}`, 400);
  }

  const updatedRequest = await staffWorkflowService.resolveRequest(
    staffUserId,
    paramResult.data.requestId,
    bodyResult.data,
  );

  res.status(200).json({
    status: 'success',
    data: { request: updatedRequest },
  });
}

/**
 * POST /api/v1/staff/requests/:requestId/reject
 * Rejects an assigned or in-progress request (-> rejected).
 */
export async function rejectRequest(req: Request, res: Response): Promise<void> {
  const staffUserId = req.user!.id;
  const paramResult = requestIdParamSchema.safeParse(req.params);
  if (!paramResult.success) {
    const errorMsg = paramResult.error.issues.map((i) => i.message).join(', ');
    throw new AppError(`Validation failed: ${errorMsg}`, 400);
  }

  const bodyResult = rejectRequestSchema.safeParse(req.body);
  if (!bodyResult.success) {
    const errorMsg = bodyResult.error.issues.map((i) => i.message).join(', ');
    throw new AppError(`Validation failed: ${errorMsg}`, 400);
  }

  const updatedRequest = await staffWorkflowService.rejectRequest(
    staffUserId,
    paramResult.data.requestId,
    bodyResult.data,
  );

  res.status(200).json({
    status: 'success',
    data: { request: updatedRequest },
  });
}

/**
 * POST /api/v1/staff/requests/:requestId/return
 * Returns an assigned or in-progress request back to its department authority queue.
 */
export async function returnRequest(req: Request, res: Response): Promise<void> {
  const staffUserId = req.user!.id;
  const paramResult = requestIdParamSchema.safeParse(req.params);
  if (!paramResult.success) {
    const errorMsg = paramResult.error.issues.map((i) => i.message).join(', ');
    throw new AppError(`Validation failed: ${errorMsg}`, 400);
  }

  const bodyResult = returnRequestSchema.safeParse(req.body);
  if (!bodyResult.success) {
    const errorMsg = bodyResult.error.issues.map((i) => i.message).join(', ');
    throw new AppError(`Validation failed: ${errorMsg}`, 400);
  }

  const updatedRequest = await staffWorkflowService.returnRequest(
    staffUserId,
    paramResult.data.requestId,
    bodyResult.data,
  );

  res.status(200).json({
    status: 'success',
    data: { request: updatedRequest },
  });
}

/**
 * POST /api/v1/staff/requests/:requestId/escalate
 * Escalates an assigned or in-progress request to the next department authority tier queue.
 */
export async function escalateRequest(req: Request, res: Response): Promise<void> {
  const staffUserId = req.user!.id;
  const paramResult = requestIdParamSchema.safeParse(req.params);
  if (!paramResult.success) {
    const errorMsg = paramResult.error.issues.map((i) => i.message).join(', ');
    throw new AppError(`Validation failed: ${errorMsg}`, 400);
  }

  const bodyResult = escalateRequestSchema.safeParse(req.body);
  if (!bodyResult.success) {
    const errorMsg = bodyResult.error.issues.map((i) => i.message).join(', ');
    throw new AppError(`Validation failed: ${errorMsg}`, 400);
  }

  const result = await staffWorkflowService.escalateRequest(
    staffUserId,
    paramResult.data.requestId,
    bodyResult.data,
  );

  res.status(200).json({
    status: 'success',
    data: result,
  });
}
