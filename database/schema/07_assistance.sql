-- Interdepartmental assistance database structures.
-- Keep this module after requests and request_assignments in the master schema.

CREATE TABLE IF NOT EXISTS department_category_compatibilities (
  id                           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  origin_category_id           UUID NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  supporting_department_id     UUID NOT NULL REFERENCES departments(id) ON DELETE RESTRICT,
  supporting_category_id       UUID NOT NULL,
  is_active                    BOOLEAN NOT NULL DEFAULT TRUE,
  created_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT department_category_compatibilities_route_unique
    UNIQUE (origin_category_id, supporting_department_id, supporting_category_id),
  CONSTRAINT department_category_compatibilities_route_id_unique
    UNIQUE (id, origin_category_id, supporting_department_id, supporting_category_id),
  CONSTRAINT department_category_compatibilities_support_category_fk
    FOREIGN KEY (supporting_category_id, supporting_department_id)
    REFERENCES categories(id, department_id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_requests_id_initial_category
  ON requests (id, initial_category_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_request_assignments_request_id_assignee
  ON request_assignments (request_id, id, assignee_id);

CREATE TABLE IF NOT EXISTS request_assistance_tasks (
  id                              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_request_id               UUID NOT NULL REFERENCES requests(id) ON DELETE RESTRICT,
  created_by_handler_id           UUID NOT NULL REFERENCES staff_profiles(user_id) ON DELETE RESTRICT,
  parent_assignment_id            UUID NOT NULL,
  parent_origin_department_id     UUID NOT NULL,
  parent_origin_category_id       UUID NOT NULL,
  original_compatibility_id       UUID NOT NULL,
  compatibility_id                UUID NOT NULL,
  original_supporting_department_id UUID NOT NULL,
  original_supporting_category_id  UUID NOT NULL,
  original_supporting_authority_level_id UUID NOT NULL,
  supporting_department_id        UUID NOT NULL,
  supporting_category_id          UUID NOT NULL,
  supporting_authority_level_id   UUID NOT NULL,
  title                           VARCHAR(255) NOT NULL,
  description                     TEXT NOT NULL,
  reason                          TEXT NOT NULL,
  priority                        VARCHAR(20) NOT NULL DEFAULT 'medium',
  status                          VARCHAR(20) NOT NULL DEFAULT 'pending',
  ever_claimed_at                 TIMESTAMPTZ,
  due_at                          TIMESTAMPTZ,
  closed_at                       TIMESTAMPTZ,
  correction_count               INTEGER NOT NULL DEFAULT 0,
  deleted_at                      TIMESTAMPTZ,
  created_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT request_assistance_tasks_id_parent_unique UNIQUE (id, parent_request_id),
  CONSTRAINT request_assistance_tasks_id_origin_category_unique UNIQUE (id, parent_origin_category_id),
  CONSTRAINT request_assistance_tasks_origin_category_fk
    FOREIGN KEY (parent_request_id, parent_origin_category_id)
    REFERENCES requests(id, initial_category_id) ON DELETE RESTRICT,
  CONSTRAINT request_assistance_tasks_origin_route_fk
    FOREIGN KEY (parent_origin_category_id, parent_origin_department_id)
    REFERENCES categories(id, department_id) ON DELETE RESTRICT,
  CONSTRAINT request_assistance_tasks_parent_assignment_fk
    FOREIGN KEY (parent_request_id, parent_assignment_id, created_by_handler_id)
    REFERENCES request_assignments(request_id, id, assignee_id) ON DELETE RESTRICT,
  CONSTRAINT request_assistance_tasks_compatibility_fk
    FOREIGN KEY (compatibility_id, parent_origin_category_id, supporting_department_id, supporting_category_id)
    REFERENCES department_category_compatibilities(id, origin_category_id, supporting_department_id, supporting_category_id)
    ON DELETE RESTRICT,
  CONSTRAINT request_assistance_tasks_original_compatibility_fk
    FOREIGN KEY (original_compatibility_id, parent_origin_category_id,
      original_supporting_department_id, original_supporting_category_id)
    REFERENCES department_category_compatibilities(id, origin_category_id, supporting_department_id, supporting_category_id)
    ON DELETE RESTRICT,
  CONSTRAINT request_assistance_tasks_original_category_fk
    FOREIGN KEY (original_supporting_category_id, original_supporting_department_id)
    REFERENCES categories(id, department_id) ON DELETE RESTRICT,
  CONSTRAINT request_assistance_tasks_original_authority_fk
    FOREIGN KEY (original_supporting_authority_level_id, original_supporting_department_id)
    REFERENCES department_authority_levels(id, department_id) ON DELETE RESTRICT,
  CONSTRAINT request_assistance_tasks_supporting_category_fk
    FOREIGN KEY (supporting_category_id, supporting_department_id)
    REFERENCES categories(id, department_id) ON DELETE RESTRICT,
  CONSTRAINT request_assistance_tasks_supporting_authority_fk
    FOREIGN KEY (supporting_authority_level_id, supporting_department_id)
    REFERENCES department_authority_levels(id, department_id) ON DELETE RESTRICT,
  CONSTRAINT request_assistance_tasks_priority_allowed
    CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  CONSTRAINT request_assistance_tasks_status_allowed
    CHECK (status IN ('pending', 'assigned', 'in_progress', 'completed', 'rejected', 'closed', 'cancelled')),
  CONSTRAINT request_assistance_tasks_title_nonblank CHECK (btrim(title) <> ''),
  CONSTRAINT request_assistance_tasks_description_nonblank CHECK (btrim(description) <> ''),
  CONSTRAINT request_assistance_tasks_reason_nonblank CHECK (btrim(reason) <> ''),
  CONSTRAINT request_assistance_tasks_correction_nonnegative CHECK (correction_count >= 0),
  CONSTRAINT request_assistance_tasks_deleted_only_unclaimed_pending
    CHECK (deleted_at IS NULL OR (status = 'pending' AND ever_claimed_at IS NULL)),
  CONSTRAINT request_assistance_tasks_closed_timestamp
    CHECK (status <> 'closed' OR closed_at IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS request_assistance_assignments (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id           UUID NOT NULL REFERENCES request_assistance_tasks(id) ON DELETE RESTRICT,
  staff_user_id     UUID NOT NULL REFERENCES staff_profiles(user_id) ON DELETE RESTRICT,
  department_id     UUID NOT NULL REFERENCES departments(id) ON DELETE RESTRICT,
  source            VARCHAR(32) NOT NULL DEFAULT 'claim',
  started_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at          TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT request_assistance_assignments_task_id_unique UNIQUE (task_id, id),
  CONSTRAINT request_assistance_assignments_task_staff_unique UNIQUE (task_id, id, staff_user_id),
  CONSTRAINT request_assistance_assignments_range CHECK (ended_at IS NULL OR ended_at >= started_at),
  CONSTRAINT request_assistance_assignments_source_allowed
    CHECK (source IN ('claim', 'admin_reassignment', 'transfer_restore'))
);

CREATE TABLE IF NOT EXISTS request_assistance_history (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id     UUID NOT NULL REFERENCES request_assistance_tasks(id) ON DELETE RESTRICT,
  parent_request_id UUID NOT NULL,
  actor_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  action      VARCHAR(64) NOT NULL,
  old_value   TEXT,
  new_value   TEXT,
  details     JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT request_assistance_history_action_nonblank CHECK (btrim(action) <> ''),
  CONSTRAINT request_assistance_history_task_parent_fk
    FOREIGN KEY (task_id, parent_request_id)
    REFERENCES request_assistance_tasks(id, parent_request_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS request_assistance_department_transfers (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id               UUID NOT NULL REFERENCES request_assistance_tasks(id) ON DELETE RESTRICT,
  initiated_by          UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  previous_status       VARCHAR(20) NOT NULL,
  parent_origin_category_id UUID NOT NULL,
  previous_compatibility_id UUID NOT NULL,
  previous_department_id UUID NOT NULL REFERENCES departments(id) ON DELETE RESTRICT,
  previous_category_id  UUID NOT NULL,
  previous_authority_level_id UUID NOT NULL,
  previous_assignment_id UUID,
  previous_handler_id   UUID REFERENCES staff_profiles(user_id) ON DELETE RESTRICT,
  target_department_id  UUID NOT NULL REFERENCES departments(id) ON DELETE RESTRICT,
  target_category_id    UUID NOT NULL,
  target_authority_level_id UUID NOT NULL,
  target_compatibility_id UUID NOT NULL,
  reason                TEXT NOT NULL,
  status                VARCHAR(20) NOT NULL DEFAULT 'pending',
  decided_by            UUID REFERENCES users(id) ON DELETE RESTRICT,
  rejection_reason      TEXT,
  cancelled_by          UUID REFERENCES users(id) ON DELETE RESTRICT,
  cancellation_reason   TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decided_at            TIMESTAMPTZ,
  cancelled_at          TIMESTAMPTZ,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT assistance_transfers_previous_route_category_fk
    FOREIGN KEY (previous_category_id, previous_department_id)
    REFERENCES categories(id, department_id) ON DELETE RESTRICT,
  CONSTRAINT assistance_transfers_parent_origin_fk
    FOREIGN KEY (task_id, parent_origin_category_id)
    REFERENCES request_assistance_tasks(id, parent_origin_category_id) ON DELETE RESTRICT,
  CONSTRAINT assistance_transfers_previous_compatibility_fk
    FOREIGN KEY (previous_compatibility_id, parent_origin_category_id,
      previous_department_id, previous_category_id)
    REFERENCES department_category_compatibilities(id, origin_category_id,
      supporting_department_id, supporting_category_id) ON DELETE RESTRICT,
  CONSTRAINT assistance_transfers_previous_route_authority_fk
    FOREIGN KEY (previous_authority_level_id, previous_department_id)
    REFERENCES department_authority_levels(id, department_id) ON DELETE RESTRICT,
  CONSTRAINT assistance_transfers_target_route_category_fk
    FOREIGN KEY (target_category_id, target_department_id)
    REFERENCES categories(id, department_id) ON DELETE RESTRICT,
  CONSTRAINT assistance_transfers_target_route_authority_fk
    FOREIGN KEY (target_authority_level_id, target_department_id)
    REFERENCES department_authority_levels(id, department_id) ON DELETE RESTRICT,
  CONSTRAINT assistance_transfers_target_compatibility_fk
    FOREIGN KEY (target_compatibility_id, parent_origin_category_id,
      target_department_id, target_category_id)
    REFERENCES department_category_compatibilities(id, origin_category_id,
      supporting_department_id, supporting_category_id) ON DELETE RESTRICT,
  CONSTRAINT assistance_transfers_previous_assignment_fk
    FOREIGN KEY (task_id, previous_assignment_id, previous_handler_id)
    REFERENCES request_assistance_assignments(task_id, id, staff_user_id) ON DELETE RESTRICT,
  CONSTRAINT assistance_transfers_previous_assignment_pair
    CHECK ((previous_assignment_id IS NULL) = (previous_handler_id IS NULL)),
  CONSTRAINT assistance_transfers_previous_status_allowed
    CHECK (previous_status IN ('pending', 'assigned', 'in_progress', 'completed', 'rejected')),
  CONSTRAINT assistance_transfers_departments_differ
    CHECK (previous_department_id <> target_department_id),
  CONSTRAINT assistance_transfers_assignment_status_consistency
    CHECK ((previous_status IN ('assigned', 'in_progress') AND previous_assignment_id IS NOT NULL)
        OR (previous_status NOT IN ('assigned', 'in_progress') AND previous_assignment_id IS NULL)),
  CONSTRAINT assistance_transfers_status_allowed
    CHECK (status IN ('pending', 'accepted', 'rejected', 'cancelled')),
  CONSTRAINT assistance_transfers_reason_nonblank CHECK (btrim(reason) <> ''),
  CONSTRAINT assistance_transfers_rejection_reason
    CHECK (status <> 'rejected' OR btrim(COALESCE(rejection_reason, '')) <> ''),
  CONSTRAINT assistance_transfers_decision_consistency
    CHECK ((status = 'pending' AND decided_at IS NULL AND decided_by IS NULL AND cancelled_at IS NULL)
        OR (status IN ('accepted', 'rejected') AND decided_at IS NOT NULL AND decided_by IS NOT NULL AND cancelled_at IS NULL)
        OR (status = 'cancelled' AND decided_at IS NOT NULL AND cancelled_at IS NOT NULL
            AND btrim(COALESCE(cancellation_reason, '')) <> ''))
);

CREATE TABLE IF NOT EXISTS request_assistance_reopen_requests (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id         UUID NOT NULL REFERENCES request_assistance_tasks(id) ON DELETE RESTRICT,
  requested_by    UUID NOT NULL REFERENCES staff_profiles(user_id) ON DELETE RESTRICT,
  explanation     TEXT NOT NULL,
  status          VARCHAR(20) NOT NULL DEFAULT 'pending',
  decided_by      UUID REFERENCES users(id) ON DELETE RESTRICT,
  decline_reason  TEXT,
  cancellation_reason TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decided_at      TIMESTAMPTZ,
  CONSTRAINT assistance_reopen_explanation_nonblank CHECK (btrim(explanation) <> ''),
  CONSTRAINT assistance_reopen_status_allowed CHECK (status IN ('pending', 'approved', 'declined', 'cancelled')),
  CONSTRAINT assistance_reopen_decline_reason
    CHECK (status <> 'declined' OR btrim(COALESCE(decline_reason, '')) <> ''),
  CONSTRAINT assistance_reopen_decision_consistency
    CHECK ((status = 'pending' AND decided_at IS NULL AND decided_by IS NULL)
        OR (status IN ('approved', 'declined') AND decided_at IS NOT NULL AND decided_by IS NOT NULL)
        OR (status = 'cancelled' AND decided_at IS NOT NULL
            AND btrim(COALESCE(cancellation_reason, '')) <> ''))
);

CREATE TABLE IF NOT EXISTS request_assistance_messages (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id        UUID NOT NULL REFERENCES request_assistance_tasks(id) ON DELETE RESTRICT,
  author_id      UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  assignment_id  UUID,
  content        TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT request_assistance_messages_id_task_unique UNIQUE (id, task_id),
  CONSTRAINT request_assistance_messages_id_task_author_unique UNIQUE (id, task_id, author_id),
  CONSTRAINT assistance_messages_content_nonblank CHECK (btrim(content) <> ''),
  CONSTRAINT assistance_messages_task_assignment_fk
    FOREIGN KEY (task_id, assignment_id, author_id)
    REFERENCES request_assistance_assignments(task_id, id, staff_user_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS request_assistance_message_reads (
  message_id UUID NOT NULL REFERENCES request_assistance_messages(id) ON DELETE RESTRICT,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  read_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (message_id, user_id)
);

CREATE TABLE IF NOT EXISTS request_assistance_attachments (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id          UUID NOT NULL REFERENCES request_assistance_tasks(id) ON DELETE RESTRICT,
  message_id       UUID NOT NULL,
  uploaded_by      UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  original_name    VARCHAR(255) NOT NULL,
  storage_backend  VARCHAR(40) NOT NULL DEFAULT 'local',
  storage_key      VARCHAR(500) NOT NULL,
  mime_type        VARCHAR(100),
  file_size_bytes  BIGINT,
  checksum_sha256  CHAR(64),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT assistance_attachments_message_task_fk
    FOREIGN KEY (message_id, task_id, uploaded_by)
    REFERENCES request_assistance_messages(id, task_id, author_id) ON DELETE RESTRICT,
  CONSTRAINT assistance_attachments_size_nonnegative CHECK (file_size_bytes IS NULL OR file_size_bytes >= 0),
  CONSTRAINT assistance_attachments_backend_allowed
    CHECK (storage_backend IN ('local', 's3', 'gcs', 'azure')),
  CONSTRAINT assistance_attachments_sha256_format
    CHECK (checksum_sha256 IS NULL OR checksum_sha256 ~ '^[0-9a-f]{64}$')
);
