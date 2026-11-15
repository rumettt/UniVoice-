CREATE INDEX IF NOT EXISTS idx_assistance_compatibility_origin_active
  ON department_category_compatibilities (origin_category_id, supporting_department_id)
  WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_assistance_tasks_parent_active
  ON request_assistance_tasks (parent_request_id, status)
  WHERE deleted_at IS NULL AND status NOT IN ('closed', 'cancelled');
CREATE INDEX IF NOT EXISTS idx_assistance_tasks_queue
  ON request_assistance_tasks (supporting_department_id, supporting_authority_level_id, priority, created_at)
  WHERE deleted_at IS NULL AND status = 'pending';
CREATE INDEX IF NOT EXISTS idx_assistance_tasks_due_open
  ON request_assistance_tasks (due_at)
  WHERE deleted_at IS NULL AND due_at IS NOT NULL
    AND status IN ('pending', 'assigned', 'in_progress');

CREATE UNIQUE INDEX IF NOT EXISTS uq_assistance_one_active_assignment
  ON request_assistance_assignments (task_id)
  WHERE ended_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_assistance_assignments_staff_live
  ON request_assistance_assignments (staff_user_id, department_id)
  WHERE ended_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_assistance_assignments_task_history
  ON request_assistance_assignments (task_id, started_at, id);

CREATE INDEX IF NOT EXISTS idx_assistance_history_task_created
  ON request_assistance_history (task_id, created_at, id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_assistance_one_pending_transfer
  ON request_assistance_department_transfers (task_id)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_assistance_transfers_target_pending
  ON request_assistance_department_transfers (target_department_id, created_at)
  WHERE status = 'pending';
CREATE UNIQUE INDEX IF NOT EXISTS uq_assistance_one_pending_reopen
  ON request_assistance_reopen_requests (task_id)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_assistance_reopens_requester
  ON request_assistance_reopen_requests (requested_by, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_assistance_messages_task_order
  ON request_assistance_messages (task_id, created_at, id);
CREATE INDEX IF NOT EXISTS idx_assistance_reads_user
  ON request_assistance_message_reads (user_id, read_at DESC);
CREATE INDEX IF NOT EXISTS idx_assistance_attachments_message
  ON request_assistance_attachments (message_id, created_at);
CREATE INDEX IF NOT EXISTS idx_notifications_assistance_task
  ON notifications (assistance_task_id)
  WHERE assistance_task_id IS NOT NULL;
