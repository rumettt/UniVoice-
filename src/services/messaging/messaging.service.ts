import { PoolClient } from 'pg';
import { pool } from '../../config/db';
import { AppError } from '../../utils/AppError';
import { messagingRepository, CommentRecord, AttachmentRecord } from '../../repositories/messaging.repository';
import { requestRepository } from '../../repositories/request.repository';
import { requestWorkflowRepository } from '../../repositories/requestWorkflow.repository';
import { systemSettingsRepository } from '../../repositories/systemSettings.repository';
import { storageAdapter } from '../../utils/storage';
import { env } from '../../config/env';
import {
  SendMessageInput,
  StaffReplyInput,
  StaffReopenFromClosedInput,
  StaffRejectFurtherInput,
  GetMessagesQueryInput,
} from '../../validators/messaging.validators';

// ---------------------------------------------------------------------------
// Notification hook points (Phase 8 — not implemented here)
// ---------------------------------------------------------------------------
// Events to emit when the notification system is added:
//   'message_sent'                 — student sent a message on a closed request
//   'staff_replied'                — staff replied to a closed-request conversation
//   'request_reopened_by_staff'    — staff reopened a closed request
//   'further_action_rejected'      — staff rejected further action with an explanation
//
// Each service method below has a TODO comment at the point where dispatch should occur.

// ---------------------------------------------------------------------------
// Allowed MIME types for file attachments
// ---------------------------------------------------------------------------
const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
  'text/csv',
]);

/**
 * Validates buffer magic bytes against expected MIME types to detect spoofed uploads
 * (e.g. an executable or script disguised with an allowed extension or Content-Type header).
 */
function validateBufferContent(buffer: Buffer, claimedMime: string): void {
  // Reject empty files
  if (buffer.length === 0) {
    throw new AppError('File buffer cannot be empty', 400);
  }

  // Reject Windows executables (PE header 'MZ')
  if (buffer.length >= 2 && buffer[0] === 0x4d && buffer[1] === 0x5a) {
    throw new AppError('Executable files are strictly forbidden', 400);
  }

  // Reject ELF binaries
  if (buffer.length >= 4 && buffer[0] === 0x7f && buffer[1] === 0x45 && buffer[2] === 0x4c && buffer[3] === 0x46) {
    throw new AppError('Binary executable files are strictly forbidden', 400);
  }

  // Reject Mach-O binaries
  if (
    buffer.length >= 4 &&
    ((buffer[0] === 0xfe && buffer[1] === 0xed && buffer[2] === 0xfa && buffer[3] === 0xce) ||
      (buffer[0] === 0xfe && buffer[1] === 0xed && buffer[2] === 0xfa && buffer[3] === 0xcf) ||
      (buffer[0] === 0xca && buffer[1] === 0xfe && buffer[2] === 0xba && buffer[3] === 0xbe))
  ) {
    throw new AppError('Binary executable files are strictly forbidden', 400);
  }

  // Verify specific signatures when claimed
  if (claimedMime === 'application/pdf') {
    // PDF signature '%PDF' -> 0x25, 0x50, 0x44, 0x46
    if (buffer.length < 4 || buffer.toString('ascii', 0, 4) !== '%PDF') {
      throw new AppError('File content does not match claimed PDF format', 400);
    }
  } else if (claimedMime === 'image/jpeg') {
    // JPEG signature: 0xFF, 0xD8, 0xFF
    if (buffer.length < 3 || buffer[0] !== 0xff || buffer[1] !== 0xd8 || buffer[2] !== 0xff) {
      throw new AppError('File content does not match claimed JPEG format', 400);
    }
  } else if (claimedMime === 'image/png') {
    // PNG signature: 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A
    const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    if (buffer.length < 8 || !pngSignature.every((byte, idx) => buffer[idx] === byte)) {
      throw new AppError('File content does not match claimed PNG format', 400);
    }
  } else if (claimedMime === 'image/gif') {
    // GIF signature 'GIF87a' or 'GIF89a'
    const header = buffer.toString('ascii', 0, 6);
    if (header !== 'GIF87a' && header !== 'GIF89a') {
      throw new AppError('File content does not match claimed GIF format', 400);
    }
  } else if (claimedMime === 'image/webp') {
    // WebP signature 'RIFF' at 0 and 'WEBP' at 8
    if (
      buffer.length < 12 ||
      buffer.toString('ascii', 0, 4) !== 'RIFF' ||
      buffer.toString('ascii', 8, 12) !== 'WEBP'
    ) {
      throw new AppError('File content does not match claimed WebP format', 400);
    }
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConversationResult {
  messages: CommentRecord[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface AttachmentUploadResult {
  attachment: AttachmentRecord;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class MessagingService {
  /**
   * Student sends a message on their own closed request.
   * - Request must exist, belong to student, and be in 'closed' status.
   * - Sending does NOT change the request status.
   * - Message is student_visible.
   * - Identifies last handler for routing (but does not change assignment).
   */
  async studentSendMessage(
    studentUserId: string,
    requestId: string,
    input: SendMessageInput,
  ): Promise<CommentRecord> {
    const client: PoolClient = await pool.connect();
    try {
      await client.query('BEGIN');

      // Lock request and verify ownership + status
      const reqRes = await client.query<{
        id: string;
        student_id: string;
        status: string;
        deleted_at: Date | null;
      }>(
        `SELECT id, student_id, status, deleted_at
         FROM requests
         WHERE id = $1
         FOR UPDATE;`,
        [requestId],
      );

      if (
        reqRes.rows.length === 0 ||
        reqRes.rows[0].deleted_at !== null ||
        reqRes.rows[0].student_id !== studentUserId
      ) {
        const err = new AppError('Request not found', 404);
        throw err;
      }

      const req = reqRes.rows[0];

      if (req.status !== 'closed') {
        throw new AppError(
          'Messages can only be sent on closed requests. If you need further help, contact support.',
          400,
        );
      }

      const comment = await messagingRepository.insertComment(
        { requestId, authorId: studentUserId, content: input.content, visibility: 'student_visible' },
        client,
      );

      await client.query('COMMIT');

      // TODO(notifications): emit 'message_sent' event { requestId, commentId: comment.id, authorId: studentUserId }

      return comment;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Student retrieves the student-visible conversation on their own closed request.
   */
  async studentGetConversation(
    studentUserId: string,
    requestId: string,
    query: GetMessagesQueryInput,
  ): Promise<ConversationResult> {
    // Verify ownership — return 404 for other students (prevents enumeration)
    const req = await requestRepository.findById(requestId);
    if (!req || req.studentId !== studentUserId || req.deletedAt !== null) {
      throw new AppError('Request not found', 404);
    }

    if (req.status !== 'closed') {
      throw new AppError('Conversation is only available for closed requests', 400);
    }

    const { messages, total } = await messagingRepository.getStudentVisibleMessages(
      requestId,
      query.page,
      query.limit,
    );

    return {
      messages,
      total,
      page: query.page,
      limit: query.limit,
      totalPages: Math.ceil(total / query.limit) || 1,
    };
  }

  /**
   * Staff retrieves the full student-visible conversation for a request they last handled.
   */
  async staffGetConversation(
    staffUserId: string,
    requestId: string,
    query: GetMessagesQueryInput,
  ): Promise<ConversationResult> {
    await this.verifyStaffIsLastHandler(staffUserId, requestId);

    const { messages, total } = await messagingRepository.getStudentVisibleMessages(
      requestId,
      query.page,
      query.limit,
    );

    return {
      messages,
      total,
      page: query.page,
      limit: query.limit,
      totalPages: Math.ceil(total / query.limit) || 1,
    };
  }

  /**
   * Staff replies to the student conversation on a closed request.
   * - Staff must be the last handler.
   * - Request must be closed.
   * - Reply is student_visible; request status does not change.
   */
  async staffReply(
    staffUserId: string,
    requestId: string,
    input: StaffReplyInput,
  ): Promise<CommentRecord> {
    const client: PoolClient = await pool.connect();
    try {
      await client.query('BEGIN');

      const req = await this.lockAndVerifyClosedRequest(requestId, client);
      await this.verifyStaffIsLastHandler(staffUserId, req.id, client);

      const comment = await messagingRepository.insertComment(
        { requestId, authorId: staffUserId, content: input.content, visibility: 'student_visible' },
        client,
      );

      await client.query('COMMIT');

      // TODO(notifications): emit 'staff_replied' event { requestId, commentId: comment.id, staffUserId }

      return comment;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Staff reopens a closed request and returns it to the authority-level queue.
   * - Staff must be the last handler.
   * - Enforces the same reopen_count limit and time-window as student reopening.
   * - Increments the shared reopen_count counter.
   * - Records the reason and lifecycle event via the existing trigger.
   */
  async staffReopenFromClosed(
    staffUserId: string,
    requestId: string,
    input: StaffReopenFromClosedInput,
  ): Promise<{ requestId: string; status: string }> {
    // Verify last-handler before entering the transaction (avoid lock contention on mismatch)
    await this.verifyStaffIsLastHandler(staffUserId, requestId);

    const settings = await systemSettingsRepository.getWorkflowSettings();

    try {
      const updated = await requestWorkflowRepository.reopenRequestByStaff(
        requestId,
        staffUserId,
        input.reason,
        settings.maxReopenCount,
        settings.reopenWindowDays,
      );

      // TODO(notifications): emit 'request_reopened_by_staff' event { requestId, staffUserId, reason: input.reason }

      return { requestId: updated.id, status: updated.status };
    } catch (err: unknown) {
      if (err instanceof AppError) throw err;
      if (err && typeof err === 'object' && 'code' in err) {
        const e = err as { code: string; message: string };
        if (e.code === 'not_found') throw new AppError('Request not found', 404);
        if (e.code === 'rejection_final') throw new AppError(e.message, 400);
        if (e.code === 'invalid_transition') throw new AppError(e.message, 400);
        if (e.code === 'reopen_limit_exceeded') throw new AppError(e.message, 400);
        if (e.code === 'window_expired') throw new AppError(e.message, 400);
      }
      throw err;
    }
  }

  /**
   * Staff permanently closes further communication on a closed request.
   * - Staff must be the last handler.
   * - Request must be closed.
   * - Explanation is student_visible (posted as a comment).
   * - Decision is recorded in request_history with action 'further_action_rejected'.
   * - Request status does NOT change (stays 'closed').
   */
  async staffRejectFurther(
    staffUserId: string,
    requestId: string,
    input: StaffRejectFurtherInput,
  ): Promise<CommentRecord> {
    const client: PoolClient = await pool.connect();
    try {
      await client.query('BEGIN');

      const req = await this.lockAndVerifyClosedRequest(requestId, client);
      await this.verifyStaffIsLastHandler(staffUserId, req.id, client);

      // Post explanation as a student_visible comment
      const comment = await messagingRepository.insertComment(
        { requestId, authorId: staffUserId, content: input.explanation, visibility: 'student_visible' },
        client,
      );

      // Record the decision in request_history (manual insert — status does not change, so the trigger won't fire)
      await client.query(
        `INSERT INTO request_history
           (request_id, actor_id, action, status_before, status_after, details)
         SELECT
           $1 AS request_id,
           $2 AS actor_id,
           'further_action_rejected' AS action,
           status AS status_before,
           status AS status_after,
           jsonb_build_object(
             'explanation', $3,
             'comment_id', $4::text
           ) AS details
         FROM requests
         WHERE id = $1;`,
        [requestId, staffUserId, input.explanation, comment.id],
      );

      await client.query('COMMIT');

      // TODO(notifications): emit 'further_action_rejected' event { requestId, staffUserId, commentId: comment.id }

      return comment;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  // ---------------------------------------------------------------------------
  // Attachment upload
  // ---------------------------------------------------------------------------

  /**
   * Upload a file attachment to a closed-request conversation.
   * - Actor must be the student owner or the last handler staff member.
   * - File is stored via the StorageAdapter (never in PostgreSQL).
   * - Metadata is persisted in the attachments table.
   */
  async uploadAttachment(params: {
    actorId: string;
    actorRole: 'student' | 'staff';
    requestId: string;
    commentId: string | null;
    buffer: Buffer;
    originalName: string;
    mimeType: string;
    sizeBytes: number;
  }): Promise<AttachmentUploadResult> {
    // Validate MIME type
    if (!ALLOWED_MIME_TYPES.has(params.mimeType)) {
      throw new AppError(
        `File type '${params.mimeType}' is not allowed. Allowed types: images, PDF, Word, Excel, plain text.`,
        400,
      );
    }

    // Validate actual file content magic bytes
    validateBufferContent(params.buffer, params.mimeType);

    // Validate size
    const maxBytes = env.STORAGE_MAX_FILE_SIZE_BYTES;
    if (params.sizeBytes > maxBytes) {
      throw new AppError(
        `File size exceeds the maximum allowed limit of ${Math.round(maxBytes / 1024 / 1024)} MB.`,
        400,
      );
    }

    // Verify actor authorisation
    const req = await requestRepository.findById(params.requestId);
    if (!req || req.deletedAt !== null) {
      throw new AppError('Request not found', 404);
    }

    if (params.actorRole === 'student') {
      if (req.studentId !== params.actorId) {
        throw new AppError('Request not found', 404);
      }
      if (req.status !== 'closed') {
        throw new AppError('Attachments can only be added to closed requests', 400);
      }
    } else {
      // staff
      await this.verifyStaffIsLastHandler(params.actorId, params.requestId);
      if (req.status !== 'closed') {
        throw new AppError('Attachments can only be added to closed requests', 400);
      }
    }

    // Store the file
    const { storageKey, backend } = await storageAdapter.store({
      buffer: params.buffer,
      originalName: params.originalName,
      mimeType: params.mimeType,
      sizeBytes: params.sizeBytes,
    });

    // Persist metadata in a transaction
    const client: PoolClient = await pool.connect();
    try {
      await client.query('BEGIN');
      const attachment = await messagingRepository.insertAttachment(
        {
          requestId: params.requestId,
          commentId: params.commentId,
          uploadedBy: params.actorId,
          originalName: params.originalName,
          storageBackend: backend,
          storageKey,
          mimeType: params.mimeType,
          fileSizeBytes: params.sizeBytes,
        },
        client,
      );
      await client.query('COMMIT');
      return { attachment };
    } catch (err) {
      await client.query('ROLLBACK');
      // Best-effort cleanup of orphaned file
      await storageAdapter.delete(storageKey, backend).catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Resolve a download location for an attachment, after authorising the requesting user.
   */
  async getAttachmentDownloadUrl(
    actorId: string,
    actorRole: 'student' | 'staff' | 'admin',
    attachmentId: string,
  ): Promise<{ url: string; originalName: string; mimeType: string | null }> {
    const attachment = await messagingRepository.findAttachmentById(attachmentId);
    if (!attachment) {
      throw new AppError('Attachment not found', 404);
    }

    // Authorisation
    if (actorRole === 'admin') {
      // Admins have audit access
    } else if (actorRole === 'student') {
      // Student must own the parent request
      const req = await requestRepository.findById(attachment.requestId);
      if (!req || req.studentId !== actorId || req.deletedAt !== null) {
        throw new AppError('Attachment not found', 404);
      }
    } else {
      // Staff must be the last handler
      await this.verifyStaffIsLastHandler(actorId, attachment.requestId);
    }

    const url = await storageAdapter.getSignedUrl(
      attachment.storageKey,
      attachment.storageBackend as 'local' | 's3' | 'gcs' | 'azure',
    );

    return { url, originalName: attachment.originalName, mimeType: attachment.mimeType };
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  /**
   * Lock the request FOR UPDATE and verify it is in 'closed' status.
   * Returns the locked request row.
   */
  private async lockAndVerifyClosedRequest(
    requestId: string,
    client: PoolClient,
  ): Promise<{ id: string; status: string }> {
    const res = await client.query<{ id: string; status: string; deleted_at: Date | null }>(
      `SELECT id, status, deleted_at FROM requests WHERE id = $1 FOR UPDATE;`,
      [requestId],
    );

    if (res.rows.length === 0 || res.rows[0].deleted_at !== null) {
      throw new AppError('Request not found', 404);
    }

    if (res.rows[0].status !== 'closed') {
      throw new AppError(
        `This action is only available for closed requests (current status: '${res.rows[0].status}').`,
        400,
      );
    }

    return res.rows[0];
  }

  /**
   * Verify that staffUserId is the last handler of the given request.
   * Throws 403 if the check fails.
   * Accepts an optional PoolClient for use inside transactions.
   */
  private async verifyStaffIsLastHandler(
    staffUserId: string,
    requestId: string,
    client?: PoolClient,
  ): Promise<void> {
    const lastHandler = await messagingRepository.getLastHandler(requestId, client);
    if (!lastHandler || lastHandler.staffUserId !== staffUserId) {
      throw new AppError(
        'Only the last handler of this request can perform this action',
        403,
      );
    }
  }
}

export const messagingService = new MessagingService();
