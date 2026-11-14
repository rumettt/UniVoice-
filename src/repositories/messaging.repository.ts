import { PoolClient } from 'pg';
import { pool } from '../config/db';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CommentRecord {
  id: string;
  requestId: string;
  authorId: string | null;
  authorName: string | null;
  authorRole: string | null;
  content: string;
  visibility: 'student_visible' | 'internal';
  createdAt: Date;
  updatedAt: Date;
}

export interface AttachmentRecord {
  id: string;
  requestId: string;
  commentId: string | null;
  uploadedBy: string | null;
  originalName: string;
  storageBackend: string;
  storageKey: string;
  mimeType: string | null;
  fileSizeBytes: number | null;
  checksumSha256: string | null;
  createdAt: Date;
}

export interface LastHandlerRecord {
  staffUserId: string;
  departmentId: string;
  startedAt: Date;
  endedAt: Date | null;
}

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

export class MessagingRepository {
  /**
   * Insert a new comment on a request within an existing transaction client.
   * visibility must be 'student_visible' | 'internal'.
   */
  async insertComment(
    params: {
      requestId: string;
      authorId: string;
      content: string;
      visibility: 'student_visible' | 'internal';
    },
    client: PoolClient,
  ): Promise<CommentRecord> {
    const res = await client.query<{
      id: string;
      request_id: string;
      author_id: string | null;
      full_name: string | null;
      role: string | null;
      content: string;
      visibility: 'student_visible' | 'internal';
      created_at: Date;
      updated_at: Date;
    }>(
      `INSERT INTO comments (request_id, author_id, content, visibility)
       VALUES ($1, $2, $3, $4)
       RETURNING
         id,
         request_id,
         author_id,
         NULL::text AS full_name,
         NULL::text AS role,
         content,
         visibility,
         created_at,
         updated_at;`,
      [params.requestId, params.authorId, params.content, params.visibility],
    );
    return this.mapComment(res.rows[0]);
  }

  /**
   * Fetch student-visible comments for a request, oldest first, with author details.
   */
  async getStudentVisibleMessages(
    requestId: string,
    page: number,
    limit: number,
    client?: PoolClient,
  ): Promise<{ messages: CommentRecord[]; total: number }> {
    const db = client ?? pool;
    const offset = (page - 1) * limit;

    const countRes = await db.query<{ total: string }>(
      `SELECT COUNT(*)::text AS total
       FROM comments
       WHERE request_id = $1
         AND visibility = 'student_visible'
         AND deleted_at IS NULL;`,
      [requestId],
    );
    const total = parseInt(countRes.rows[0].total, 10);

    const res = await db.query<{
      id: string;
      request_id: string;
      author_id: string | null;
      full_name: string | null;
      role: string | null;
      content: string;
      visibility: 'student_visible' | 'internal';
      created_at: Date;
      updated_at: Date;
    }>(
      `SELECT
         c.id,
         c.request_id,
         c.author_id,
         u.full_name,
         u.role,
         c.content,
         c.visibility,
         c.created_at,
         c.updated_at
       FROM comments c
       LEFT JOIN users u ON u.id = c.author_id
       WHERE c.request_id = $1
         AND c.visibility = 'student_visible'
         AND c.deleted_at IS NULL
       ORDER BY c.created_at ASC
       LIMIT $2 OFFSET $3;`,
      [requestId, limit, offset],
    );
    return { messages: res.rows.map(this.mapComment), total };
  }

  /**
   * Find the most recent handling assignment record for a request (last handler).
   * Identifies the staff member who actually handled the request prior to resolution/closure:
   * 1. If an active assignment exists (ended_at IS NULL), that assignee is current.
   * 2. Otherwise, returns the most recent assignment that either ended_at IS NOT NULL
   *    or was active, ordered by ended_at DESC NULLS FIRST, started_at DESC.
   */
  async getLastHandler(requestId: string, client?: PoolClient): Promise<LastHandlerRecord | null> {
    const db = client ?? pool;
    const res = await db.query<{
      assignee_id: string;
      department_id: string;
      started_at: Date;
      ended_at: Date | null;
    }>(
      `SELECT assignee_id, department_id, started_at, ended_at
       FROM request_assignments
       WHERE request_id = $1
       ORDER BY (ended_at IS NULL) DESC, COALESCE(ended_at, started_at) DESC, started_at DESC
       LIMIT 1;`,
      [requestId],
    );
    if (res.rows.length === 0) return null;
    const row = res.rows[0];
    return {
      staffUserId: row.assignee_id,
      departmentId: row.department_id,
      startedAt: row.started_at,
      endedAt: row.ended_at,
    };
  }

  /**
   * Insert attachment metadata. Actual file bytes are stored separately via StorageAdapter.
   */
  async insertAttachment(
    params: {
      requestId: string;
      commentId: string | null;
      uploadedBy: string;
      originalName: string;
      storageBackend: string;
      storageKey: string;
      mimeType: string;
      fileSizeBytes: number;
      checksumSha256?: string | null;
    },
    client: PoolClient,
  ): Promise<AttachmentRecord> {
    const res = await client.query<{
      id: string;
      request_id: string;
      comment_id: string | null;
      uploaded_by: string | null;
      original_name: string;
      storage_backend: string;
      storage_key: string;
      mime_type: string | null;
      file_size_bytes: number | null;
      checksum_sha256: string | null;
      created_at: Date;
    }>(
      `INSERT INTO attachments
         (request_id, comment_id, uploaded_by, original_name, storage_backend, storage_key, mime_type, file_size_bytes, checksum_sha256)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *;`,
      [
        params.requestId,
        params.commentId,
        params.uploadedBy,
        params.originalName,
        params.storageBackend,
        params.storageKey,
        params.mimeType,
        params.fileSizeBytes,
        params.checksumSha256 ?? null,
      ],
    );
    return this.mapAttachment(res.rows[0]);
  }

  /**
   * Find a single attachment by ID.
   */
  async findAttachmentById(
    attachmentId: string,
    client?: PoolClient,
  ): Promise<AttachmentRecord | null> {
    const db = client ?? pool;
    const res = await db.query<{
      id: string;
      request_id: string;
      comment_id: string | null;
      uploaded_by: string | null;
      original_name: string;
      storage_backend: string;
      storage_key: string;
      mime_type: string | null;
      file_size_bytes: number | null;
      checksum_sha256: string | null;
      created_at: Date;
    }>(
      `SELECT * FROM attachments WHERE id = $1 AND deleted_at IS NULL;`,
      [attachmentId],
    );
    if (res.rows.length === 0) return null;
    return this.mapAttachment(res.rows[0]);
  }

  /**
   * Soft-delete an attachment record.
   */
  async softDeleteAttachment(attachmentId: string, client: PoolClient): Promise<void> {
    await client.query(
      `UPDATE attachments SET deleted_at = NOW() WHERE id = $1;`,
      [attachmentId],
    );
  }

  // ---------------------------------------------------------------------------
  // Mappers
  // ---------------------------------------------------------------------------

  private mapComment(row: {
    id: string;
    request_id: string;
    author_id: string | null;
    full_name: string | null;
    role: string | null;
    content: string;
    visibility: 'student_visible' | 'internal';
    created_at: Date;
    updated_at: Date;
  }): CommentRecord {
    return {
      id: row.id,
      requestId: row.request_id,
      authorId: row.author_id,
      authorName: row.full_name,
      authorRole: row.role,
      content: row.content,
      visibility: row.visibility,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private mapAttachment(row: {
    id: string;
    request_id: string;
    comment_id: string | null;
    uploaded_by: string | null;
    original_name: string;
    storage_backend: string;
    storage_key: string;
    mime_type: string | null;
    file_size_bytes: number | null;
    checksum_sha256: string | null;
    created_at: Date;
  }): AttachmentRecord {
    return {
      id: row.id,
      requestId: row.request_id,
      commentId: row.comment_id,
      uploadedBy: row.uploaded_by,
      originalName: row.original_name,
      storageBackend: row.storage_backend,
      storageKey: row.storage_key,
      mimeType: row.mime_type,
      fileSizeBytes: row.file_size_bytes,
      checksumSha256: row.checksum_sha256,
      createdAt: row.created_at,
    };
  }
}

export const messagingRepository = new MessagingRepository();
