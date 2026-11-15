import { Request, Response } from 'express';
import { AppError } from '../utils/AppError';
import { transferService } from '../services/staff/transfer.service';
import {
  initiateTransferSchema,
  rejectTransferSchema,
  transferQuerySchema,
} from '../validators/transfer.validators';
import { requestIdParamSchema } from '../validators/request.validators';
import { z } from 'zod';

const transferIdParamSchema = z.object({
  transferId: z.string().uuid('Invalid transfer ID'),
});

/**
 * POST /api/v1/staff/requests/:requestId/transfers
 * Initiates permanent transfer of a request to another department.
 */
export async function initiateTransfer(req: Request, res: Response): Promise<void> {
  if (!req.user) throw new AppError('Authentication required', 401);

  const paramResult = requestIdParamSchema.safeParse(req.params);
  if (!paramResult.success) {
    const errorMsg = paramResult.error.issues.map((i) => i.message).join(', ');
    throw new AppError(`Validation failed: ${errorMsg}`, 400);
  }

  const bodyResult = initiateTransferSchema.safeParse(req.body);
  if (!bodyResult.success) {
    const errorMsg = bodyResult.error.issues.map((i) => i.message).join(', ');
    throw new AppError(`Validation failed: ${errorMsg}`, 400);
  }

  const transfer = await transferService.initiateTransfer(
    req.user.id,
    req.user.role,
    paramResult.data.requestId,
    bodyResult.data,
  );

  res.status(201).json({
    status: 'success',
    data: { transfer },
  });
}

/**
 * GET /api/v1/staff/requests/:requestId/transfers
 * Retrieves transfer history for a specific request.
 */
export async function getRequestTransfers(req: Request, res: Response): Promise<void> {
  if (!req.user) throw new AppError('Authentication required', 401);

  const paramResult = requestIdParamSchema.safeParse(req.params);
  if (!paramResult.success) {
    const errorMsg = paramResult.error.issues.map((i) => i.message).join(', ');
    throw new AppError(`Validation failed: ${errorMsg}`, 400);
  }

  const transfers = await transferService.getRequestTransfers(
    req.user.id,
    req.user.role,
    paramResult.data.requestId,
  );

  res.status(200).json({
    status: 'success',
    data: { transfers },
  });
}

/**
 * GET /api/v1/staff/transfers/pending
 * Retrieves pending transfers awaiting decision.
 */
export async function getPendingTransfers(req: Request, res: Response): Promise<void> {
  if (!req.user) throw new AppError('Authentication required', 401);

  const queryResult = transferQuerySchema.safeParse(req.query);
  if (!queryResult.success) {
    const errorMsg = queryResult.error.issues.map((i) => i.message).join(', ');
    throw new AppError(`Validation failed: ${errorMsg}`, 400);
  }

  const result = await transferService.getPendingTransfers(
    req.user.id,
    req.user.role,
    queryResult.data,
  );

  res.status(200).json({
    status: 'success',
    data: result,
  });
}

/**
 * POST /api/v1/staff/transfers/:transferId/accept
 * Receiving department staff accepts an incoming transfer.
 */
export async function acceptTransfer(req: Request, res: Response): Promise<void> {
  if (!req.user) throw new AppError('Authentication required', 401);

  const paramResult = transferIdParamSchema.safeParse(req.params);
  if (!paramResult.success) {
    const errorMsg = paramResult.error.issues.map((i) => i.message).join(', ');
    throw new AppError(`Validation failed: ${errorMsg}`, 400);
  }

  const transfer = await transferService.acceptTransfer(
    req.user.id,
    req.user.role,
    paramResult.data.transferId,
  );

  res.status(200).json({
    status: 'success',
    data: { transfer },
  });
}

/**
 * POST /api/v1/staff/transfers/:transferId/reject
 * Receiving department staff rejects an incoming transfer.
 */
export async function rejectTransfer(req: Request, res: Response): Promise<void> {
  if (!req.user) throw new AppError('Authentication required', 401);

  const paramResult = transferIdParamSchema.safeParse(req.params);
  if (!paramResult.success) {
    const errorMsg = paramResult.error.issues.map((i) => i.message).join(', ');
    throw new AppError(`Validation failed: ${errorMsg}`, 400);
  }

  const bodyResult = rejectTransferSchema.safeParse(req.body);
  if (!bodyResult.success) {
    const errorMsg = bodyResult.error.issues.map((i) => i.message).join(', ');
    throw new AppError(`Validation failed: ${errorMsg}`, 400);
  }

  const transfer = await transferService.rejectTransfer(
    req.user.id,
    req.user.role,
    paramResult.data.transferId,
    bodyResult.data,
  );

  res.status(200).json({
    status: 'success',
    data: { transfer },
  });
}
