import { Request, Response } from 'express';
import { requestService } from '../services/student/request.service';
import {
  createRequestSchema,
  requestQuerySchema,
  requestIdParamSchema,
} from '../validators/request.validators';
import { AppError } from '../utils/AppError';

/**
 * POST /api/v1/requests
 * Submit a new student request.
 */
export async function submitRequest(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    throw new AppError('Authentication required', 401);
  }

  const parseResult = createRequestSchema.safeParse(req.body);
  if (!parseResult.success) {
    const errorMsg = parseResult.error.issues.map((i) => i.message).join(', ');
    throw new AppError(`Validation failed: ${errorMsg}`, 400);
  }

  const request = await requestService.submitRequest(req.user.id, parseResult.data);

  res.status(201).json({
    status: 'success',
    data: { request },
  });
}

/**
 * GET /api/v1/requests/me
 * Retrieve paginated requests submitted by the authenticated student.
 */
export async function getMyRequests(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    throw new AppError('Authentication required', 401);
  }

  const parseResult = requestQuerySchema.safeParse(req.query);
  if (!parseResult.success) {
    const errorMsg = parseResult.error.issues.map((i) => i.message).join(', ');
    throw new AppError(`Validation failed: ${errorMsg}`, 400);
  }

  const result = await requestService.getStudentRequests(
    req.user.id,
    parseResult.data,
  );

  res.status(200).json({
    status: 'success',
    data: result,
  });
}

/**
 * GET /api/v1/requests/:requestId
 * Retrieve single request details for the authenticated student.
 */
export async function getRequestById(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    throw new AppError('Authentication required', 401);
  }

  const parseResult = requestIdParamSchema.safeParse(req.params);
  if (!parseResult.success) {
    const errorMsg = parseResult.error.issues.map((i) => i.message).join(', ');
    throw new AppError(`Validation failed: ${errorMsg}`, 400);
  }

  const request = await requestService.getRequestDetails(
    req.user.id,
    parseResult.data.requestId,
  );

  res.status(200).json({
    status: 'success',
    data: { request },
  });
}
