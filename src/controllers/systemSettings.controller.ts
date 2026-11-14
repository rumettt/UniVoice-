import { Request, Response } from 'express';
import { systemSettingsService } from '../services/admin/systemSettings.service';
import { updateWorkflowSettingsSchema } from '../validators/systemSettings.validators';
import { AppError } from '../utils/AppError';

export async function getWorkflowSettings(req: Request, res: Response): Promise<void> {
  const settings = await systemSettingsService.getWorkflowSettings();
  res.status(200).json({
    status: 'success',
    data: settings,
  });
}

export async function updateWorkflowSettings(req: Request, res: Response): Promise<void> {
  const adminUserId = req.user!.id;
  const parseResult = updateWorkflowSettingsSchema.safeParse(req.body);
  if (!parseResult.success) {
    const errorMsg = parseResult.error.issues.map((i) => i.message).join(', ');
    throw new AppError(`Validation failed: ${errorMsg}`, 400);
  }

  const updated = await systemSettingsService.updateWorkflowSettings(
    adminUserId,
    parseResult.data,
  );

  res.status(200).json({
    status: 'success',
    data: updated,
  });
}
