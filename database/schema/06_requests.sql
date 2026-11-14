-- Request reference sequence, consumed by request creation logic.
CREATE SEQUENCE IF NOT EXISTS request_ref_seq AS BIGINT START WITH 1 INCREMENT BY 1;

-- 6. Requests (current operational state)
-- ---------------------------------------------------------------------------

CREATE TABLE requests (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  public_ref                  VARCHAR(32) NOT NULL,
  title                       VARCHAR(255) NOT NULL,
  description                 TEXT NOT NULL,
  student_id                  UUID NOT NULL REFERENCES student_profiles(user_id) ON DELETE RESTRICT,
  category_id                 UUID NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  responsible_department_id   UUID NOT NULL REFERENCES departments(id) ON DELETE RESTRICT,
  current_authority_level_id  UUID NOT NULL,
  current_assignment_id       UUID,
  current_escalation_id       UUID,
  created_by                  UUID REFERENCES users(id) ON DELETE RESTRICT,
  updated_by                  UUID REFERENCES users(id) ON DELETE RESTRICT,
  priority                    VARCHAR(20) NOT NULL DEFAULT 'medium',
  status                      VARCHAR(20) NOT NULL DEFAULT 'pending',
  due_at                      TIMESTAMPTZ,
  resolution_category         VARCHAR(100),
  resolution_notes            TEXT,
  resolved_at                 TIMESTAMPTZ,
  closed_at                   TIMESTAMPTZ,
  first_closed_at             TIMESTAMPTZ,
  rejected_at                 TIMESTAMPTZ,
  rejection_reason            TEXT,
  reopen_count                INTEGER NOT NULL DEFAULT 0,
  last_reopen_reason          TEXT,
  deleted_at                  TIMESTAMPTZ,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT requests_public_ref_unique UNIQUE (public_ref),
  CONSTRAINT requests_priority_allowed
    CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  CONSTRAINT requests_status_allowed
    CHECK (status IN ('pending', 'assigned', 'in_progress', 'resolved', 'closed', 'rejected')),
  CONSTRAINT requests_title_not_blank CHECK (btrim(title) <> ''),
  CONSTRAINT requests_description_not_blank CHECK (btrim(description) <> ''),
  CONSTRAINT requests_reopen_count_nonnegative CHECK (reopen_count >= 0),
  CONSTRAINT requests_assigned_status_has_assignee
    CHECK (
      status NOT IN ('assigned', 'in_progress')
      OR current_assignment_id IS NOT NULL
    ),
  CONSTRAINT requests_pending_is_unassigned
    CHECK (
      status <> 'pending'
      OR current_assignment_id IS NULL
    ),
  CONSTRAINT requests_resolved_has_resolved_at
    CHECK (status <> 'resolved' OR resolved_at IS NOT NULL),
  CONSTRAINT requests_closed_has_closed_at
    CHECK (status <> 'closed' OR closed_at IS NOT NULL),
  CONSTRAINT requests_rejected_has_rejected_at
    CHECK (status <> 'rejected' OR rejected_at IS NOT NULL),
  CONSTRAINT requests_resolution_category_allowed
    CHECK (resolution_category IS NULL OR resolution_category IN (
      'resolved_fully',
      'workaround_provided',
      'information_provided',
      'referred_to_external',
      'other'
    )),
  CONSTRAINT requests_resolved_has_category
    CHECK (status <> 'resolved' OR resolution_category IS NOT NULL),
  CONSTRAINT requests_resolved_has_notes
    CHECK (status <> 'resolved' OR btrim(COALESCE(resolution_notes, '')) <> ''),
  CONSTRAINT requests_rejected_has_reason
    CHECK (status <> 'rejected' OR btrim(COALESCE(rejection_reason, '')) <> ''),
  CONSTRAINT requests_lifecycle_timestamps
    CHECK (
      (resolved_at IS NULL OR resolved_at >= created_at)
      AND (closed_at IS NULL OR closed_at >= created_at)
    ),

  -- Composite foreign keys enforcing category/department and authority/department integrity
  CONSTRAINT requests_category_department_fk
    FOREIGN KEY (category_id, responsible_department_id)
    REFERENCES categories(id, department_id)
    ON DELETE RESTRICT,
  CONSTRAINT requests_authority_level_dept_fk
    FOREIGN KEY (current_authority_level_id, responsible_department_id)
    REFERENCES department_authority_levels(id, department_id)
    ON DELETE RESTRICT
);

COMMENT ON TABLE requests IS
  'Current operational state of a student request. Maintains responsible department and authority level.';
COMMENT ON COLUMN requests.responsible_department_id IS
  'Department currently accountable for the request, whether queued or actively assigned.';
COMMENT ON COLUMN requests.current_authority_level_id IS
  'Authority tier responsible for the request (both while in queue and during active assignment).';
COMMENT ON COLUMN requests.current_assignment_id IS
  'Pointer to the live assignment row in request_assignments. NULL denotes waiting in an authority queue.';
COMMENT ON COLUMN requests.current_escalation_id IS
  'Pointer to the active or most recent escalation record in request_escalations.';

-- ---------------------------------------------------------------------------
