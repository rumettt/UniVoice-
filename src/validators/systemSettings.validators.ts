import { z } from 'zod';

export const updateWorkflowSettingsSchema = z
  .object({
    reopenWindowDays: z
      .number()
      .int('reopenWindowDays must be an integer')
      .min(1, 'reopenWindowDays must be at least 1 day')
      .optional(),
    maxReopenCount: z
      .number()
      .int('maxReopenCount must be an integer')
      .min(1, 'maxReopenCount must be at least 1')
      .max(5, 'maxReopenCount cannot exceed 5')
      .optional(),
  })
  .strict()
  .refine(
    (data) => data.reopenWindowDays !== undefined || data.maxReopenCount !== undefined,
    { message: 'At least one setting must be provided for update' },
  );

export type UpdateWorkflowSettingsInput = z.infer<typeof updateWorkflowSettingsSchema>;
