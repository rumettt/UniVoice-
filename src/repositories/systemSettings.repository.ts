import { PoolClient } from 'pg';
import { pool } from '../config/db';

export interface WorkflowSettings {
  reopenWindowDays: number;
  maxReopenCount: number;
}

export class SystemSettingsRepository {
  /**
   * Retrieves workflow settings from system_settings table,
   * falling back to default values (7 days, 2 max reopenings) if not set.
   */
  async getWorkflowSettings(client?: PoolClient): Promise<WorkflowSettings> {
    const executor = client ?? pool;
    const query = `
      SELECT key, value
      FROM system_settings
      WHERE key IN ('request_workflow.reopen_window_days', 'request_workflow.max_reopen_count');
    `;

    const res = await executor.query(query);
    let reopenWindowDays = 7;
    let maxReopenCount = 2;

    for (const row of res.rows) {
      if (row.key === 'request_workflow.reopen_window_days' && row.value?.days != null) {
        reopenWindowDays = Number(row.value.days);
      }
      if (row.key === 'request_workflow.max_reopen_count' && row.value?.max != null) {
        maxReopenCount = Number(row.value.max);
      }
    }

    return { reopenWindowDays, maxReopenCount };
  }

  /**
   * Updates request workflow settings atomically.
   */
  async updateWorkflowSettings(
    settings: { reopenWindowDays?: number; maxReopenCount?: number },
    adminUserId: string,
    client?: PoolClient,
  ): Promise<WorkflowSettings> {
    const isExternalClient = Boolean(client);
    const dbClient = client ?? (await pool.connect());

    try {
      if (!isExternalClient) {
        await dbClient.query('BEGIN');
      }

      if (settings.reopenWindowDays !== undefined) {
        await dbClient.query(
          `INSERT INTO system_settings (key, value, description, updated_by, updated_at)
           VALUES ('request_workflow.reopen_window_days', $1, 'Global request reopening time window in days', $2, NOW())
           ON CONFLICT (key) DO UPDATE
             SET value = EXCLUDED.value,
                 updated_by = EXCLUDED.updated_by,
                 updated_at = NOW();`,
          [JSON.stringify({ days: settings.reopenWindowDays }), adminUserId],
        );
      }

      if (settings.maxReopenCount !== undefined) {
        await dbClient.query(
          `INSERT INTO system_settings (key, value, description, updated_by, updated_at)
           VALUES ('request_workflow.max_reopen_count', $1, 'Maximum number of times a student may reopen a closed request', $2, NOW())
           ON CONFLICT (key) DO UPDATE
             SET value = EXCLUDED.value,
                 updated_by = EXCLUDED.updated_by,
                 updated_at = NOW();`,
          [JSON.stringify({ max: settings.maxReopenCount }), adminUserId],
        );
      }

      const updated = await this.getWorkflowSettings(dbClient);

      if (!isExternalClient) {
        await dbClient.query('COMMIT');
      }

      return updated;
    } catch (err) {
      if (!isExternalClient) {
        await dbClient.query('ROLLBACK');
      }
      throw err;
    } finally {
      if (!isExternalClient) {
        dbClient.release();
      }
    }
  }
}

export const systemSettingsRepository = new SystemSettingsRepository();
