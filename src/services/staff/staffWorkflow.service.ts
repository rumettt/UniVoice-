import {
  requestWorkflowRepository,
} from '../../repositories/requestWorkflow.repository';
import { RequestRecord } from '../../repositories/request.repository';
import { AppError } from '../../utils/AppError';
import {
  ResolveRequestInput,
  RejectRequestInput,
  ReturnRequestInput,
  EscalateRequestInput,
} from '../../validators/requestWorkflow.validators';

export class StaffWorkflowService {
  /**
   * Starts processing an assigned request.
   */
  async startProcessing(staffUserId: string, requestId: string): Promise<RequestRecord> {
    try {
      return await requestWorkflowRepository.startProcessing(requestId, staffUserId);
    } catch (err: unknown) {
      this.handleRepositoryError(err);
    }
  }

  /**
   * Resolves an in-progress request.
   */
  async resolveRequest(
    staffUserId: string,
    requestId: string,
    input: ResolveRequestInput,
  ): Promise<RequestRecord> {
    try {
      return await requestWorkflowRepository.resolveRequest(requestId, staffUserId, input);
    } catch (err: unknown) {
      this.handleRepositoryError(err);
    }
  }

  /**
   * Rejects an assigned or in-progress request.
   */
  async rejectRequest(
    staffUserId: string,
    requestId: string,
    input: RejectRequestInput,
  ): Promise<RequestRecord> {
    try {
      return await requestWorkflowRepository.rejectRequest(requestId, staffUserId, input);
    } catch (err: unknown) {
      this.handleRepositoryError(err);
    }
  }

  /**
   * Returns an assigned or in-progress request back to its department authority queue.
   */
  async returnRequest(
    staffUserId: string,
    requestId: string,
    input: ReturnRequestInput,
  ): Promise<RequestRecord> {
    try {
      return await requestWorkflowRepository.returnRequest(requestId, staffUserId, input);
    } catch (err: unknown) {
      this.handleRepositoryError(err);
    }
  }

  /**
   * Escalates an assigned or in-progress request to the next department authority queue.
   */
  async escalateRequest(
    staffUserId: string,
    requestId: string,
    input: EscalateRequestInput,
  ): Promise<{ request: RequestRecord; escalationId: string }> {
    try {
      return await requestWorkflowRepository.escalateRequest(requestId, staffUserId, input);
    } catch (err: unknown) {
      this.handleRepositoryError(err);
    }
  }

  private handleRepositoryError(err: unknown): never {
    if (err instanceof AppError) {
      throw err;
    }

    if (err && typeof err === 'object') {
      const customErr = err as { code?: string; message?: string };
      const msg = customErr.message || '';
      const code = customErr.code;

      if (
        code === 'not_found' ||
        code === 'no_data_found' ||
        code === 'P0002' ||
        msg.includes('does not exist') ||
        msg.includes('not found') ||
        msg.includes('has been deleted')
      ) {
        throw new AppError('Request not found', 404);
      }

      if (
        code === 'forbidden' ||
        code === 'insufficient_privilege' ||
        code === '42501' ||
        msg.includes('Only the currently assigned staff member')
      ) {
        throw new AppError(msg || 'Forbidden', 403);
      }

      if (
        code === 'invalid_transition' ||
        code === 'object_not_in_prerequisite_state' ||
        code === '55000' ||
        msg.includes('Only actively assigned requests') ||
        msg.includes('cannot be started') ||
        msg.includes('cannot be resolved') ||
        msg.includes('cannot be rejected')
      ) {
        throw new AppError(msg || 'Invalid state transition', 400);
      }

      if (code === 'check_violation' || code === '23514') {
        if (msg.includes('highest authority level')) {
          throw new AppError(
            'Request is already at the highest authority level for this department',
            400,
          );
        }
        if (msg.includes('cannot be blank')) {
          throw new AppError(msg, 400);
        }
        throw new AppError(`Database check constraint violated: ${msg}`, 400);
      }
    }

    throw err;
  }
}

export const staffWorkflowService = new StaffWorkflowService();
