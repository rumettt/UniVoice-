import { z } from 'zod';

export const createAuthorityLevelSchema = z.object({
  departmentId: z.string().uuid('Valid department ID is required'),
  code: z.string().trim().min(1, 'Code is required').max(40),
  name: z.string().trim().min(1, 'Name is required').max(100),
  levelOrder: z.number().int().min(1, 'levelOrder must be an integer >= 1'),
  description: z.string().trim().optional().nullable(),
});

export const updateAuthorityLevelSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  description: z.string().trim().optional().nullable(),
  isActive: z.boolean().optional(),
});

export const reorderAuthorityLevelsSchema = z.object({
  departmentId: z.string().uuid('Valid department ID is required'),
  levels: z
    .array(
      z.object({
        id: z.string().uuid('Valid authority level ID is required'),
        levelOrder: z.number().int().min(1, 'levelOrder must be an integer >= 1'),
      }),
    )
    .min(1, 'At least one authority level must be provided'),
});

export const assignStaffAuthorityLevelSchema = z.object({
  staffUserId: z.string().uuid('Valid staff user ID is required'),
  departmentAuthorityLevelId: z.string().uuid('Valid authority level ID is required'),
  departmentId: z.string().uuid('Valid department ID is required'),
  validFrom: z.string().datetime().optional(),
  validTo: z.string().datetime().optional().nullable(),
});

export const endStaffAuthorityLevelSchema = z
  .object({
    validTo: z.string().datetime().optional(),
  })
  .optional()
  .default({});

export type CreateAuthorityLevelInput = z.infer<typeof createAuthorityLevelSchema>;
export type UpdateAuthorityLevelInput = z.infer<typeof updateAuthorityLevelSchema>;
export type ReorderAuthorityLevelsInput = z.infer<typeof reorderAuthorityLevelsSchema>;
export type AssignStaffAuthorityLevelInput = z.infer<typeof assignStaffAuthorityLevelSchema>;
export type EndStaffAuthorityLevelInput = z.infer<typeof endStaffAuthorityLevelSchema>;
