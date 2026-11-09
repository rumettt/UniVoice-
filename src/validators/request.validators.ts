import { z } from 'zod';

/**
 * UUID v4 / PostgreSQL standard UUID validation.
 */
export const requestUuidSchema = z.string().uuid('Must be a valid UUID');

/**
 * Allowed operational status for student request listing filter.
 */
export const requestStatusSchema = z.enum([
  'pending',
  'assigned',
  'in_progress',
  'resolved',
  'closed',
  'rejected',
]);

/**
 * Validator for student request submission.
 * Uses .strict() to reject any extraneous fields (preventing mass assignment
 * of departmentId, currentAuthorityLevelId, status, assignments, priority, etc.).
 */
export const createRequestSchema = z
  .object({
    categoryId: z.string().uuid('Valid category ID is required'),
    title: z
      .string()
      .trim()
      .min(1, 'Title cannot be empty')
      .max(255, 'Title must not exceed 255 characters'),
    description: z.string().trim().min(1, 'Description cannot be empty'),
  })
  .strict();

export type CreateRequestInput = z.infer<typeof createRequestSchema>;

/**
 * Validator for query parameters on student request listing.
 * Enforces pagination limits (max 100) and optional filters.
 */
export const requestQuerySchema = z
  .object({
    page: z
      .string()
      .optional()
      .default('1')
      .transform((val) => Number(val))
      .refine((n) => !isNaN(n) && n > 0, 'Page must be greater than 0'),
    limit: z
      .string()
      .optional()
      .default('10')
      .transform((val) => Number(val))
      .refine(
        (n) => !isNaN(n) && n > 0 && n <= 100,
        'Limit must be between 1 and 100',
      ),
    status: requestStatusSchema.optional(),
    categoryId: z.string().uuid('Must be a valid UUID').optional(),
  })
  .strict();

export type RequestQueryInput = z.infer<typeof requestQuerySchema>;

/**
 * Validator for single request URL parameter (:requestId).
 */
export const requestIdParamSchema = z
  .object({
    requestId: z.string().uuid('Valid request ID is required'),
  })
  .strict();

export type RequestIdParamInput = z.infer<typeof requestIdParamSchema>;
