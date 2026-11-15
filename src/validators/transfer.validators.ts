import { z } from 'zod';

export const initiateTransferSchema = z
  .object({
    toDepartmentId: z.string().uuid('Invalid receiving department ID'),
    toCategoryId: z.string().uuid('Invalid receiving category ID'),
    toAuthorityLevelId: z.string().uuid('Invalid receiving authority level ID'),
    reason: z
      .string({
        error: 'Transfer reason is required',
      })
      .trim()
      .min(1, 'Transfer reason is required and cannot be blank'),
  })
  .strict();

export type InitiateTransferInput = z.infer<typeof initiateTransferSchema>;

export const rejectTransferSchema = z
  .object({
    rejectionReason: z
      .string({
        error: 'Rejection reason is required',
      })
      .trim()
      .min(1, 'Rejection reason is required and cannot be blank'),
  })
  .strict();

export type RejectTransferInput = z.infer<typeof rejectTransferSchema>;

export const transferQuerySchema = z
  .object({
    page: z
      .string()
      .regex(/^\d+$/, 'Page must be numeric')
      .default('1')
      .transform(Number),
    limit: z
      .string()
      .regex(/^\d+$/, 'Limit must be numeric')
      .default('20')
      .transform(Number),
    departmentId: z.string().uuid('Invalid department ID').optional(),
  })
  .strict();

export type TransferQueryInput = z.infer<typeof transferQuerySchema>;
