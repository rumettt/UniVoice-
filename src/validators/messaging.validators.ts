import { z } from 'zod';

// ---------------------------------------------------------------------------
// Student messaging
// ---------------------------------------------------------------------------

export const sendMessageSchema = z
  .object({
    content: z
      .string()
      .trim()
      .min(1, 'Message content is required and cannot be blank'),
  })
  .strict();

export type SendMessageInput = z.infer<typeof sendMessageSchema>;

// ---------------------------------------------------------------------------
// Staff actions on closed requests
// ---------------------------------------------------------------------------

export const staffReplySchema = z
  .object({
    content: z
      .string()
      .trim()
      .min(1, 'Reply content is required and cannot be blank'),
  })
  .strict();

export type StaffReplyInput = z.infer<typeof staffReplySchema>;

export const staffReopenFromClosedSchema = z
  .object({
    reason: z
      .string()
      .trim()
      .min(1, 'Reopening reason is required and cannot be blank'),
  })
  .strict();

export type StaffReopenFromClosedInput = z.infer<typeof staffReopenFromClosedSchema>;

export const staffRejectFurtherSchema = z
  .object({
    explanation: z
      .string()
      .trim()
      .min(1, 'Explanation is required and cannot be blank'),
  })
  .strict();

export type StaffRejectFurtherInput = z.infer<typeof staffRejectFurtherSchema>;

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

export const getMessagesQuerySchema = z
  .object({
    page: z
      .string()
      .regex(/^\d+$/, 'page must be a positive integer')
      .default('1')
      .transform(Number)
      .refine((n) => n >= 1, { message: 'page must be >= 1' }),
    limit: z
      .string()
      .regex(/^\d+$/, 'limit must be a positive integer')
      .default('50')
      .transform(Number)
      .refine((n) => n >= 1 && n <= 100, { message: 'limit must be between 1 and 100' }),
  })
  .strict();

export type GetMessagesQueryInput = z.infer<typeof getMessagesQuerySchema>;
