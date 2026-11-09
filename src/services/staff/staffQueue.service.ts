import {
  staffQueueRepository,
  StaffQueueItemRecord,
  ClaimResultRecord,
  StaffAssignmentRecord,
} from '../../repositories/staffQueue.repository';
import { AppError } from '../../utils/AppError';
import {
  StaffQueueQueryInput,
  StaffAssignmentsQueryInput,
} from '../../validators/staffQueue.validators';

export interface FormattedQueueItem {
  id: string;
  publicRef: string;
  title: string;
  descriptionPreview: string;
  priority: 'urgent' | 'high' | 'medium' | 'low';
  status: 'pending';
  createdAt: Date;
  dueAt: Date | null;
  waitingDurationSeconds: number;
  department: {
    id: string;
    name: string;
    code: string;
  };
  category: {
    id: string;
    name: string;
  };
  requiredAuthorityLevel: {
    id: string;
    name: string;
    levelOrder: number;
  };
}

export class StaffQueueService {
  /**
   * Retrieves paginated requests that the authenticated staff member is currently eligible to claim.
   * Formats queue items with waiting duration in seconds and lightweight preview descriptions.
   */
  async getEligibleQueue(
    staffUserId: string,
    filters: StaffQueueQueryInput,
  ): Promise<{
    queue: FormattedQueueItem[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const { queue, total } = await staffQueueRepository.findEligibleQueue(
      staffUserId,
      filters,
    );

    const now = Date.now();
    const formattedQueue: FormattedQueueItem[] = queue.map((item) => ({
      id: item.id,
      publicRef: item.publicRef,
      title: item.title,
      descriptionPreview:
        item.description.length > 150
          ? `${item.description.slice(0, 150)}...`
          : item.description,
      priority: item.priority,
      status: item.status,
      createdAt: item.createdAt,
      dueAt: item.dueAt,
      waitingDurationSeconds: Math.max(
        0,
        Math.floor((now - new Date(item.createdAt).getTime()) / 1000),
      ),
      department: item.department,
      category: item.category,
      requiredAuthorityLevel: item.requiredAuthorityLevel,
    }));

    const totalPages = Math.ceil(total / filters.limit) || 1;

    return {
      queue: formattedQueue,
      total,
      page: filters.page,
      limit: filters.limit,
      totalPages,
    };
  }

  /**
   * Retrieves full details for an individual queue item that the staff member is eligible to claim.
   * Returns 404 if the request does not exist, is assigned, or the staff member is not currently eligible,
   * avoiding information leakage across departments.
   */
  async getQueueItemDetails(
    staffUserId: string,
    requestId: string,
  ): Promise<StaffQueueItemRecord & { waitingDurationSeconds: number }> {
    const item = await staffQueueRepository.findEligibleQueueItemById(
      staffUserId,
      requestId,
    );

    if (!item) {
      throw new AppError('Request not found', 404);
    }

    const waitingDurationSeconds = Math.max(
      0,
      Math.floor((Date.now() - new Date(item.createdAt).getTime()) / 1000),
    );

    return {
      ...item,
      waitingDurationSeconds,
    };
  }

  /**
   * Atomically claims an eligible request for the authenticated staff member.
   * Maps database procedural exceptions to typed AppError instances according to established conventions.
   */
  async claimRequest(
    staffUserId: string,
    requestId: string,
  ): Promise<ClaimResultRecord> {
    try {
      return await staffQueueRepository.claimRequest(staffUserId, requestId);
    } catch (err: unknown) {
      if (err instanceof AppError) {
        throw err;
      }

      if (err && typeof err === 'object') {
        const errorObj = err as { code?: string; message?: string };
        const msg = errorObj.message || '';
        const code = errorObj.code;

        // 404 Not Found: Request not found or deleted
        if (
          code === 'no_data_found' ||
          code === 'P0002' ||
          msg.includes('does not exist') ||
          msg.includes('has been deleted')
        ) {
          throw new AppError('Request not found', 404);
        }

        // 409 Conflict: Request already claimed or no longer in pending state
        if (
          msg.includes('is not available to claim') ||
          msg.includes('current status')
        ) {
          throw new AppError('Request is no longer available to claim', 409);
        }

        // 409 Conflict: Staff at capacity in this department
        if (code === '23514' || msg.includes('is at capacity')) {
          throw new AppError(
            'You have reached your active request capacity in this department',
            409,
          );
        }

        // 403 Forbidden: Staff availability restriction
        if (msg.includes('currently marked unavailable')) {
          throw new AppError(
            'You are currently marked unavailable in this department',
            403,
          );
        }

        // 403 Forbidden: Authority level insufficient
        if (msg.includes('insufficient for request authority level order')) {
          throw new AppError(
            'Your authority level is insufficient to claim this request',
            403,
          );
        }

        // 403 Forbidden: Category authorization missing
        if (msg.includes('not authorized to handle category')) {
          throw new AppError(
            'You are not authorized to handle requests in this category',
            403,
          );
        }

        // 403 Forbidden: Department membership missing or no authority tier
        if (
          msg.includes('not an active member of department') ||
          msg.includes('has no active authority level in department')
        ) {
          throw new AppError(
            'You do not hold active membership or authority in this department',
            403,
          );
        }

        // 403 Forbidden: Department no longer active
        if (msg.includes('no longer active and cannot accept new claims')) {
          throw new AppError(
            'The responsible department is no longer active',
            403,
          );
        }

        // 403 Forbidden: Staff profile inactive or missing
        if (msg.includes('not active or has no staff profile')) {
          throw new AppError(
            'Staff account is not active or has no staff profile',
            403,
          );
        }

        // 500 Internal: Work settings row missing — provisioning gap
        if (
          code === 'missing_work_settings' ||
          msg.includes('Work settings row missing')
        ) {
          throw new AppError(
            'Internal error: staff work settings not found. Please contact an administrator.',
            500,
          );
        }
      }

      throw err;
    }
  }

  /**
   * Retrieves requests currently actively assigned to the authenticated staff member.
   */
  async getMyAssignedRequests(
    staffUserId: string,
    filters: StaffAssignmentsQueryInput,
  ): Promise<{
    assignments: StaffAssignmentRecord[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const { assignments, total } =
      await staffQueueRepository.findStaffActiveAssignments(
        staffUserId,
        filters,
      );
    const totalPages = Math.ceil(total / filters.limit) || 1;

    return {
      assignments,
      total,
      page: filters.page,
      limit: filters.limit,
      totalPages,
    };
  }
}

export const staffQueueService = new StaffQueueService();
