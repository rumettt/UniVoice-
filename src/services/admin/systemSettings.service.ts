import {
  systemSettingsRepository,
  WorkflowSettings,
} from '../../repositories/systemSettings.repository';
import { UpdateWorkflowSettingsInput } from '../../validators/systemSettings.validators';

export class SystemSettingsService {
  async getWorkflowSettings(): Promise<WorkflowSettings> {
    return systemSettingsRepository.getWorkflowSettings();
  }

  async updateWorkflowSettings(
    adminUserId: string,
    input: UpdateWorkflowSettingsInput,
  ): Promise<WorkflowSettings> {
    return systemSettingsRepository.updateWorkflowSettings(input, adminUserId);
  }
}

export const systemSettingsService = new SystemSettingsService();
