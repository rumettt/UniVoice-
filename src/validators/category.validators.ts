import { z } from 'zod';

export const categoryPrioritySchema = z.enum(['low', 'medium', 'high', 'urgent']);

export const createCategorySchema = z.object({
  name: z.string().trim().min(1, 'Category name is required').max(100),
  description: z.string().trim().optional().nullable(),
  departmentId: z.string().uuid('Valid department ID is required'),
  initialAuthorityLevelId: z.string().uuid('Valid initial authority level ID is required'),
  defaultPriority: categoryPrioritySchema.default('medium'),
  defaultDueHours: z
    .number()
    .int()
    .positive('defaultDueHours must be a positive integer')
    .optional()
    .nullable(),
});

export const updateCategorySchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  description: z.string().trim().optional().nullable(),
  departmentId: z.string().uuid().optional(),
  initialAuthorityLevelId: z.string().uuid().optional(),
  defaultPriority: categoryPrioritySchema.optional(),
  defaultDueHours: z
    .number()
    .int()
    .positive('defaultDueHours must be a positive integer')
    .optional()
    .nullable(),
  isActive: z.boolean().optional(),
});

export const setCategoryStatusSchema = z.object({
  isActive: z.boolean(),
});

export const categoryQuerySchema = z.object({
  departmentId: z.string().uuid().optional(),
  isActive: z
    .enum(['true', 'false'])
    .transform((val) => val === 'true')
    .optional(),
  page: z
    .string()
    .optional()
    .default('1')
    .transform((val) => Number(val))
    .refine((n) => !isNaN(n) && n > 0, 'Page must be greater than 0'),
  limit: z
    .string()
    .optional()
    .default('50')
    .transform((val) => Number(val))
    .refine((n) => !isNaN(n) && n > 0 && n <= 100, 'Limit must be between 1 and 100'),
});

export type CreateCategoryInput = z.infer<typeof createCategorySchema>;
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;
export type SetCategoryStatusInput = z.infer<typeof setCategoryStatusSchema>;
export type CategoryQueryInput = z.infer<typeof categoryQuerySchema>;
