-- 18. System Settings (global dynamic configurations)
-- ---------------------------------------------------------------------------

CREATE TABLE system_settings (
  key         VARCHAR(64) PRIMARY KEY,
  value       JSONB NOT NULL,
  description TEXT,
  updated_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE system_settings IS
  'Global dynamic platform configurations managed by administrators.';

-- Seed default request workflow configuration
INSERT INTO system_settings (key, value, description)
VALUES
  ('request_workflow.reopen_window_days', '{"days": 7}'::jsonb, 'Global request reopening time window in days'),
  ('request_workflow.max_reopen_count', '{"max": 2}'::jsonb, 'Maximum number of times a student may reopen a closed request')
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------------
