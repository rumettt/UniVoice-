-- 7. Assignment history (ownership and handling intervals)
-- ---------------------------------------------------------------------------

CREATE TABLE request_assignments (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id           UUID NOT NULL REFERENCES requests(id) ON DELETE RESTRICT,
  assignee_id          UUID NOT NULL REFERENCES staff_profiles(user_id) ON DELETE RESTRICT,
  assigned_by          UUID REFERENCES users(id) ON DELETE RESTRICT,
  department_id        UUID NOT NULL REFERENCES departments(id) ON DELETE RESTRICT,
  source               VARCHAR(40) NOT NULL,
  source_escalation_id UUID,
  started_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at             TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT request_assignments_req_id_unique UNIQUE (request_id, id),
  CONSTRAINT request_assignments_source_allowed
    CHECK (source IN (
      'claim',
      'escalation_claim',
      'initial',
      'reassignment',
      'system_assigned',
      'reopen'
    )),
  CONSTRAINT request_assignments_range
    CHECK (ended_at IS NULL OR ended_at >= started_at)
);

-- Crucial integrity guarantee: at most one active (ended_at IS NULL) assignment per request
CREATE UNIQUE INDEX uq_request_assignments_one_active
  ON request_assignments (request_id)
  WHERE ended_at IS NULL;

COMMENT ON TABLE request_assignments IS
  'Every handling interval for a request. The active handler has ended_at IS NULL.';
COMMENT ON COLUMN request_assignments.source IS
  'Origin of assignment: claim (manual queue claim), escalation_claim, initial, reassignment, or reopen.';

-- ---------------------------------------------------------------------------
