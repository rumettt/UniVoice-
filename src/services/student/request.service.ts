import { PoolClient } from 'pg';
import { pool } from '../../config/db';
import {
  requestRepository,
  RequestRecord,
} from '../../repositories/request.repository';
import { AppError } from '../../utils/AppError';
import {
  CreateRequestInput,
  RequestQueryInput,
} from '../../validators/request.validators';

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
   * Retrieves details of a specific request.
   * Strictly enforces that students can only access requests they submitted.
   * Returns 404 if the request does not exist or belongs to another student,
   * completely preventing ID enumeration and private data leakage.
   */
  async getRequestDetails(
    studentUserId: string,
    requestId: string,
  ): Promise<RequestRecord> {
    const request = await requestRepository.findById(requestId);

    if (!request || request.studentId !== studentUserId || request.deletedAt !== null) {
      throw new AppError('Request not found', 404);
    }

    return request;
  }
}

export const requestService = new RequestService();
