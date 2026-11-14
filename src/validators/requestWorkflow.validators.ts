import { z } from 'zod';

export const resolutionCategorySchema = z.enum([
  'resolved_fully',
  'workaround_provided',
  'information_provided',
  'referred_to_external',
  'other',
]);

export type ResolutionCategory = z.infer<typeof resolutionCategorySchema>;

export const resolveRequestSchema = z
  .object({
    resolutionCategory: resolutionCategorySchema,
    resolutionMessage: z
      .string()
      .trim()
      .min(1, 'Resolution message is required and cannot be blank'),
  })
  .strict();

export type ResolveRequestInput = z.infer<typeof resolveRequestSchema>;

export const rejectRequestSchema = z
  .object({
    rejectionReason: z
      .string()
      .trim()
      .min(1, 'Rejection reason is required and cannot be blank'),
  })
  .strict();

export type RejectRequestInput = z.infer<typeof rejectRequestSchema>;

export const reopenRequestSchema = z
  .object({
    reason: z
      .string()
      .trim()
      .min(1, 'Reopening reason is required and cannot be blank'),
  })
  .strict();

export type ReopenRequestInput = z.infer<typeof reopenRequestSchema>;

export const returnRequestSchema = z
  .object({
    reason: z
      .string({
        error: 'Return reason is required',
      })
      .trim()
      .min(1, 'Return reason is required and cannot be blank'),
  })
  .strict();

export type ReturnRequestInput = z.infer<typeof returnRequestSchema>;

export const escalateRequestSchema = z
  .object({
    reason: z
      .string({
        error: 'Escalation reason is required',
      })
      .trim()
      .min(1, 'Escalation reason is required and cannot be blank'),
    notes: z
      .string()
      .trim()
      .optional()
      .nullable(),
  })
  .strict();

export type EscalateRequestInput = z.infer<typeof escalateRequestSchema>;
