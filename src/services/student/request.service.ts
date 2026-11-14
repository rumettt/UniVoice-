import { PoolClient } from 'pg';
import { pool } from '../../config/db';
import {
  requestRepository,
  RequestRecord,
  StudentVisibleHistoryItem,
} from '../../repositories/request.repository';
import { requestWorkflowRepository } from '../../repositories/requestWorkflow.repository';
import { systemSettingsRepository } from '../../repositories/systemSettings.repository';
import { AppError } from '../../utils/AppError';
import {
  CreateRequestInput,
  RequestQueryInput,
} from '../../validators/request.validators';
import { ReopenRequestInput } from '../../validators/requestWorkflow.validators';

export interface StudentRequestTrackingDetails extends RequestRecord {
  assignedStaff: {
    fullName: string;
    email: string;
  } | null;
  resolution: {
    category: string | null;
    message: string | null;
  } | null;
  rejection: {
    reason: string | null;
  } | null;
  reopening: {
    isAllowed: boolean;
    remainingReopenings: number;
    maxReopenCount: number;
    windowExpiresAt: Date | null;
    remainingWindowSeconds: number | null;
    lastReopenReason: string | null;
  };
  history: StudentVisibleHistoryItem[];
}

export class RequestService {
  /**
   * Submits a new student request.
   * Executes inside an atomic transaction:
   * 1. Acquires row-level SHARE locks on the category, department, and initial authority level.
   * 2. Revalidates routing configuration (active category, active department, active authority level).
   * 3. Derives department, authority level, priority, and SLA due date server-side.
   * 4. Generates an atomic public reference number formatted as REQ-YYYY-XXXXX.
   * 5. Inserts the request row in 'pending' status into the authority queue.
   * 6. Database trigger `trg_requests_lifecycle_history` automatically creates the initial history record.
   */
  async submitRequest(
    studentUserId: string,
    input: CreateRequestInput,
  ): Promise<RequestRecord> {
    const client: PoolClient = await pool.connect();

    try {
      await client.query('BEGIN');

      // 1. Lock and revalidate category routing configuration
      const routing = await requestRepository.lockAndGetCategoryRouting(
        input.categoryId,
        client,
      );

      if (!routing) {
        throw new AppError('Category not found', 404);
      }

      if (!routing.categoryIsActive) {
        throw new AppError('Cannot submit request for an inactive category', 400);
      }

      if (!routing.departmentIsActive) {
        throw new AppError(
          'The department responsible for this category is currently inactive',
          400,
        );
      }

      if (!routing.authorityLevelIsActive) {
        throw new AppError(
          'The initial authority queue for this category is currently inactive',
          400,
        );
      }

      if (routing.authorityDepartmentId !== routing.departmentId) {
        throw new AppError(
          'Category routing configuration is invalid: initial authority level does not belong to responsible department',
          400,
        );
      }

      // 2. Generate unique reference (e.g. REQ-2026-00001)
      const publicRef = await requestRepository.generatePublicRef(client);

      // 3. Compute due date if category has default_due_hours configured
      const dueAt = routing.defaultDueHours
        ? new Date(Date.now() + routing.defaultDueHours * 3600 * 1000)
        : null;

      // 4. Insert request transactionally
      const request = await requestRepository.insertRequest(
        {
          publicRef,
          title: input.title,
          description: input.description,
          studentId: studentUserId,
          categoryId: routing.categoryId,
          responsibleDepartmentId: routing.departmentId,
          currentAuthorityLevelId: routing.authorityLevelId,
          priority: routing.defaultPriority,
          dueAt,
        },
        client,
      );

      await client.query('COMMIT');
      return request;
    } catch (err: unknown) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // Rollback error ignored if client connection was already broken
      }

      if (err instanceof AppError) {
        throw err;
      }

      // Map specific database integrity errors cleanly
      if (err && typeof err === 'object' && 'code' in err) {
        const pgErr = err as { code: string; message: string };
        if (pgErr.code === '23503') {
          throw new AppError(
            'Foreign key integrity violation: related user, category, or authority level was not found',
            400,
          );
        }
        if (pgErr.code === '23514') {
          throw new AppError(`Database check constraint violated: ${pgErr.message}`, 400);
        }
      }

      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Retrieves paginated requests submitted by the authenticated student.
   * Filters and pagination are executed entirely in SQL.
   */
  async getStudentRequests(
    studentUserId: string,
    filters: RequestQueryInput,
  ): Promise<{
    requests: RequestRecord[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const { requests, total } = await requestRepository.findStudentRequests(
      studentUserId,
      filters,
    );
    const totalPages = Math.ceil(total / filters.limit) || 1;

    return {
      requests,
      total,
      page: filters.page,
      limit: filters.limit,
      totalPages,
    };
  }

  /**
   * Retrieves comprehensive details and workflow tracking of a specific request.
   * Strictly enforces that students can only access requests they submitted.
   * Returns 404 if the request does not exist or belongs to another student,
   * completely preventing ID enumeration and private data leakage.
   */
  async getRequestDetails(
    studentUserId: string,
    requestId: string,
  ): Promise<StudentRequestTrackingDetails> {
    const request = await requestRepository.findById(requestId);

    if (!request || request.studentId !== studentUserId || request.deletedAt !== null) {
      throw new AppError('Request not found', 404);
    }

    // Retrieve workflow settings, staff handler, and student-safe timeline history concurrently
    const [settings, staffHandler, history] = await Promise.all([
      systemSettingsRepository.getWorkflowSettings().catch(() => ({
        reopenWindowDays: 7,
        maxReopenCount: 2,
      })),
      requestRepository.getAssignedOrLastStaff(requestId).catch(() => null),
      requestRepository.findStudentHistory(requestId).catch(() => []),
    ]);

    const isClosed = request.status === 'closed';
    const remainingReopenings = Math.max(0, settings.maxReopenCount - (request.reopenCount ?? 0));

    let isAllowed = false;
    let windowExpiresAt: Date | null = null;
    let remainingWindowSeconds: number | null = null;

    const anchorDate = request.firstClosedAt ?? request.closedAt ?? request.resolvedAt;
    if (isClosed && anchorDate) {
      const windowMs = settings.reopenWindowDays * 24 * 60 * 60 * 1000;
      windowExpiresAt = new Date(new Date(anchorDate).getTime() + windowMs);
      const remainingMs = windowExpiresAt.getTime() - Date.now();
      if (remainingMs > 0) {
        remainingWindowSeconds = Math.floor(remainingMs / 1000);
        isAllowed = remainingReopenings > 0;
      } else {
        remainingWindowSeconds = 0;
        isAllowed = false;
      }
    }

    return {
      ...request,
      assignedStaff: staffHandler,
      resolution:
        request.resolutionCategory || request.resolutionNotes
          ? {
              category: request.resolutionCategory ?? null,
              message: request.resolutionNotes ?? null,
            }
          : null,
      rejection: request.rejectionReason
        ? {
            reason: request.rejectionReason,
          }
        : null,
      reopening: {
        isAllowed,
        remainingReopenings,
        maxReopenCount: settings.maxReopenCount,
        windowExpiresAt,
        remainingWindowSeconds,
        lastReopenReason: request.lastReopenReason ?? null,
      },
      history,
    };
  }

  /**
   * Reopens a closed request by the owning student.
   */
  async reopenRequest(
    studentUserId: string,
    requestId: string,
    input: ReopenRequestInput,
  ): Promise<RequestRecord> {
    const settings = await systemSettingsRepository.getWorkflowSettings();

    try {
      return await requestWorkflowRepository.reopenRequest(
        requestId,
        studentUserId,
        input.reason,
        settings.maxReopenCount,
        settings.reopenWindowDays,
      );
    } catch (err: unknown) {
      if (err instanceof AppError) {
        throw err;
      }

      if (err && typeof err === 'object' && 'code' in err) {
        const customErr = err as { code: string; message: string };
        if (customErr.code === 'not_found') {
          throw new AppError('Request not found', 404);
        }
        if (customErr.code === 'rejection_final') {
          throw new AppError(customErr.message, 400);
        }
        if (customErr.code === 'invalid_transition') {
          throw new AppError(customErr.message, 400);
        }
        if (customErr.code === 'reopen_limit_exceeded') {
          throw new AppError(customErr.message, 400);
        }
        if (customErr.code === 'window_expired') {
          throw new AppError(customErr.message, 400);
        }
      }

      throw err;
    }
  }
}

export const requestService = new RequestService();
