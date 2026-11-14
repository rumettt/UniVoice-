-- 16. Standalone, partial, and performance indexes
-- ---------------------------------------------------------------------------

-- 1. Users and Authentication
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_email_lower ON users (lower(email));
CREATE INDEX IF NOT EXISTS idx_users_role_active ON users (role) WHERE is_active = TRUE AND deactivated_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_users_primary_department ON users (primary_department_id) WHERE primary_department_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens (user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_active ON refresh_tokens (token_hash) WHERE revoked_at IS NULL;

-- 2. Staff Hierarchy, Positions, and Authority Levels
CREATE UNIQUE INDEX IF NOT EXISTS uq_staff_one_current_primary_dept
  ON staff_department_memberships (staff_user_id)
  WHERE is_primary = TRUE AND valid_to IS NULL;

CREATE INDEX IF NOT EXISTS idx_staff_memberships_department
  ON staff_department_memberships (department_id)
  WHERE valid_to IS NULL;

-- Department-scoped position holding: at most one active position per department
CREATE UNIQUE INDEX IF NOT EXISTS uq_staff_one_current_position_per_dept
  ON staff_position_holdings (staff_user_id, department_id)
  WHERE valid_to IS NULL;

CREATE INDEX IF NOT EXISTS idx_staff_supervisions_supervisor
  ON staff_supervisions (supervisor_id)
  WHERE valid_to IS NULL;

CREATE INDEX IF NOT EXISTS idx_staff_supervisions_supervisee
  ON staff_supervisions (supervisee_id)
  WHERE valid_to IS NULL;

CREATE INDEX IF NOT EXISTS idx_dept_authority_levels_order
  ON department_authority_levels (department_id, level_order)
  WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_staff_dept_auth_levels_active
  ON staff_department_authority_levels (staff_user_id, department_id)
  WHERE valid_to IS NULL;

CREATE INDEX IF NOT EXISTS idx_staff_work_settings_available
  ON staff_department_work_settings (department_id, staff_user_id)
  WHERE is_available = TRUE;

-- 3. Categories and Authorizations
CREATE INDEX IF NOT EXISTS idx_categories_department
  ON categories (department_id)
  WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_categories_authority_level
  ON categories (initial_authority_level_id);

CREATE INDEX IF NOT EXISTS idx_staff_category_auth_live
  ON staff_category_authorizations (category_id, staff_user_id)
  WHERE valid_to IS NULL;

-- 4. Requests and Operational Queues
CREATE INDEX IF NOT EXISTS idx_requests_student
  ON requests (student_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_requests_department_status
  ON requests (responsible_department_id, status)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_requests_category
  ON requests (category_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_requests_status_created
  ON requests (status, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_requests_priority
  ON requests (priority)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_requests_due_open
  ON requests (due_at)
  WHERE deleted_at IS NULL AND due_at IS NOT NULL
    AND status IN ('pending', 'assigned', 'in_progress');

CREATE INDEX IF NOT EXISTS idx_requests_current_assignment
  ON requests (current_assignment_id)
  WHERE current_assignment_id IS NOT NULL;

-- High-performance index for department/authority queue polling and manual claiming
CREATE INDEX IF NOT EXISTS idx_requests_authority_queue
  ON requests (responsible_department_id, current_authority_level_id, created_at)
  WHERE deleted_at IS NULL AND current_assignment_id IS NULL AND status = 'pending';

-- 5. Assignments and Escalations
CREATE UNIQUE INDEX IF NOT EXISTS uq_request_assignments_one_active
  ON request_assignments (request_id)
  WHERE ended_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_request_assignments_request_started
  ON request_assignments (request_id, started_at);

CREATE INDEX IF NOT EXISTS idx_request_assignments_assignee_live
  ON request_assignments (assignee_id, department_id)
  WHERE ended_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_request_escalations_request_seq
  ON request_escalations (request_id, sequence_no);

CREATE INDEX IF NOT EXISTS idx_request_escalations_destination_queue
  ON request_escalations (to_authority_level_id, created_at)
  WHERE status = 'queued';

-- 6. History, Discussion, Notifications, and Audit
CREATE INDEX IF NOT EXISTS idx_request_history_request_created
  ON request_history (request_id, created_at);

CREATE INDEX IF NOT EXISTS idx_comments_request_visible
  ON comments (request_id, created_at)
  WHERE deleted_at IS NULL;

-- Student-visible paginated retrieval (Phase 7 Milestone 2)
CREATE INDEX IF NOT EXISTS idx_comments_request_visible_paginate
  ON comments (request_id, created_at ASC)
  WHERE deleted_at IS NULL AND visibility = 'student_visible';

CREATE INDEX IF NOT EXISTS idx_comments_internal
  ON comments (request_id)
  WHERE deleted_at IS NULL AND visibility = 'internal';

CREATE INDEX IF NOT EXISTS idx_attachments_request
  ON attachments (request_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_attachments_comment
  ON attachments (comment_id)
  WHERE comment_id IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_notifications_recipient_unread
  ON notifications (recipient_id, created_at DESC)
  WHERE is_read = FALSE;

CREATE INDEX IF NOT EXISTS idx_notifications_request
  ON notifications (request_id)
  WHERE request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_audit_logs_resource
  ON audit_logs (resource_type, resource_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_actor
  ON audit_logs (actor_id, created_at DESC)
  WHERE actor_id IS NOT NULL;

-- ---------------------------------------------------------------------------
