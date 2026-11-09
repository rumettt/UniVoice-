import { z } from 'zod';

export const departmentCodeRegex = /^[A-Z0-9_]{2,20}$/;

export const createDepartmentSchema = z.object({
  name: z.string().trim().min(1, 'Department name is required').max(100),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(departmentCodeRegex, 'Department code must be 2-20 uppercase alphanumeric or underscore characters'),
  description: z.string().trim().optional().nullable(),
  defaultMaxActiveRequests: z.number().int().positive('Default max active requests must be a positive integer').default(5),
});

export const updateDepartmentSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  description: z.string().trim().optional().nullable(),
  defaultMaxActiveRequests: z.number().int().positive('Default max active requests must be a positive integer').optional(),
});

export const setDepartmentStatusSchema = z.object({
  isActive: z.boolean(),
});

export const departmentQuerySchema = z.object({
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
    .default('20')
    .transform((val) => Number(val))
    .refine((n) => !isNaN(n) && n > 0 && n <= 100, 'Limit must be between 1 and 100'),
  search: z.string().trim().optional(),
});

export type CreateDepartmentInput = z.infer<typeof createDepartmentSchema>;
export type UpdateDepartmentInput = z.infer<typeof updateDepartmentSchema>;
export type SetDepartmentStatusInput = z.infer<typeof setDepartmentStatusSchema>;
export type DepartmentQueryInput = z.infer<typeof departmentQuerySchema>;
