import { z } from 'zod';

/**
 * UUID v4 / PostgreSQL standard UUID validation pattern.
 */
export const staffQueueUuidSchema = z.string().uuid('Must be a valid UUID');

/**
 * Priority values supported in staff queues.
 */
export const staffQueuePrioritySchema = z.enum([
  'urgent',
  'high',
  'medium',
  'low',
]);

/**
 * Active statuses for requests currently assigned to staff.
 */
export const staffAssignedStatusSchema = z.enum(['assigned', 'in_progress']);

/**
 * Validator for staff queue query parameters.
 * Supports optional department and priority filtering, and pagination (max limit 100).
 */
export const staffQueueQuerySchema = z
  .object({
    departmentId: staffQueueUuidSchema.optional(),
    priority: staffQueuePrioritySchema.optional(),
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
  })
  .strict();

export type StaffQueueQueryInput = z.infer<typeof staffQueueQuerySchema>;

/**
 * Validator for request ID in staff queue / claim operations.
 */
export const claimRequestParamSchema = z
  .object({
    requestId: z.string().uuid('Valid request ID is required'),
  })
  .strict();

export type ClaimRequestParamInput = z.infer<typeof claimRequestParamSchema>;

/**
 * Validator for staff's own active assignments query.
 * Supports optional department and status filtering, and pagination.
 */
export const staffAssignmentsQuerySchema = z
  .object({
    departmentId: staffQueueUuidSchema.optional(),
    status: staffAssignedStatusSchema.optional(),
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
  })
  .strict();

export type StaffAssignmentsQueryInput = z.infer<
  typeof staffAssignmentsQuerySchema
>;
