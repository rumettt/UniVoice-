import { z } from 'zod';

export const assignStaffDepartmentSchema = z.object({
  staffUserId: z.string().uuid('Valid staff user ID is required'),
  departmentId: z.string().uuid('Valid department ID is required'),
  isPrimary: z.boolean().default(false),
  validFrom: z.string().datetime().optional(),
  validTo: z.string().datetime().optional().nullable(),
});

export const endStaffDepartmentMembershipSchema = z
  .object({
    validTo: z.string().datetime().optional(),
  })
  .optional()
  .default({});

export const updateStaffWorkSettingsSchema = z.object({
  isAvailable: z.boolean().optional(),
  maxActiveRequestsOverride: z
    .number()
    .int()
    .positive('Override must be a positive integer')
    .optional()
    .nullable(),
});

export const staffQuerySchema = z.object({
  isActive: z
    .enum(['true', 'false'])
    .transform((val) => val === 'true')
    .optional(),
});

export type AssignStaffDepartmentInput = z.infer<typeof assignStaffDepartmentSchema>;
export type EndStaffDepartmentMembershipInput = z.infer<typeof endStaffDepartmentMembershipSchema>;
export type UpdateStaffWorkSettingsInput = z.infer<typeof updateStaffWorkSettingsSchema>;
