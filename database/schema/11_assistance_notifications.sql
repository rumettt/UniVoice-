ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS assistance_task_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'notifications_assistance_task_fk'
      AND conrelid = 'notifications'::regclass
  ) THEN
    ALTER TABLE notifications
      ADD CONSTRAINT notifications_assistance_task_fk
      FOREIGN KEY (assistance_task_id)
      REFERENCES request_assistance_tasks(id) ON DELETE RESTRICT;
  END IF;
END;
$$;
