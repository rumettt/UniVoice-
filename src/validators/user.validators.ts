import { z } from 'zod';

export const userRoleSchema = z.enum(['student', 'staff', 'admin']);

export const phoneRegex = /^[+0-9 ().-]{8,20}$/;

export const createStudentSchema = z.object({
  role: z.literal('student'),
  firstName: z.string().trim().min(1, 'First name is required').max(50),
  lastName: z.string().trim().min(1, 'Last name is required').max(50),
  email: z.string().trim().email('Invalid email address').max(255),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  phone: z.string().regex(phoneRegex, 'Invalid phone number format').optional().nullable(),
  studentNumber: z.string().trim().min(1, 'Student number is required').max(40),
  programName: z.string().trim().max(120).optional().nullable(),
  profileImageUrl: z.string().url().max(500).optional().nullable(),
});

export const createStaffSchema = z.object({
  role: z.literal('staff'),
  firstName: z.string().trim().min(1, 'First name is required').max(50),
  lastName: z.string().trim().min(1, 'Last name is required').max(50),
  email: z.string().trim().email('Invalid email address').max(255),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  phone: z.string().regex(phoneRegex, 'Invalid phone number format').optional().nullable(),
  employeeNumber: z.string().trim().min(1, 'Employee number is required').max(40),
  primaryDepartmentId: z.string().uuid('Valid primary department ID is required'),
  currentPositionId: z.string().uuid().optional().nullable(),
  profileImageUrl: z.string().url().max(500).optional().nullable(),
});

export const createAdminSchema = z.object({
  role: z.literal('admin'),
  firstName: z.string().trim().min(1, 'First name is required').max(50),
  lastName: z.string().trim().min(1, 'Last name is required').max(50),
  email: z.string().trim().email('Invalid email address').max(255),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  phone: z.string().regex(phoneRegex, 'Invalid phone number format').optional().nullable(),
  primaryDepartmentId: z.string().uuid().optional().nullable(),
  employeeNumber: z.string().trim().max(40).optional().nullable(),
  currentPositionId: z.string().uuid().optional().nullable(),
  profileImageUrl: z.string().url().max(500).optional().nullable(),
});

export const createUserSchema = z.discriminatedUnion('role', [
  createStudentSchema,
  createStaffSchema,
  createAdminSchema,
]);

export const updateUserProfileSchema = z.object({
  firstName: z.string().trim().min(1).max(50).optional(),
  lastName: z.string().trim().min(1).max(50).optional(),
  phone: z.string().regex(phoneRegex, 'Invalid phone number format').optional().nullable(),
  profileImageUrl: z.string().url().max(500).optional().nullable(),
});

export const setUserStatusSchema = z.object({
  isActive: z.boolean(),
});

export const userQuerySchema = z.object({
  role: userRoleSchema.optional(),
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
    .default('20')
    .transform((val) => Number(val))
    .refine((n) => !isNaN(n) && n > 0 && n <= 100, 'Limit must be between 1 and 100'),
  search: z.string().trim().optional(),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserProfileInput = z.infer<typeof updateUserProfileSchema>;
export type SetUserStatusInput = z.infer<typeof setUserStatusSchema>;
export type UserQueryInput = z.infer<typeof userQuerySchema>;
