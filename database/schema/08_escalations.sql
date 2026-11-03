-- 8. Queue-based escalations (first-class process)
-- ---------------------------------------------------------------------------

CREATE TABLE request_escalations (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id               UUID NOT NULL REFERENCES requests(id) ON DELETE RESTRICT,
  sequence_no              INTEGER NOT NULL,
  initiated_by             UUID NOT NULL REFERENCES staff_profiles(user_id) ON DELETE RESTRICT,
  from_assignment_id       UUID REFERENCES request_assignments(id) ON DELETE RESTRICT,
  from_authority_level_id  UUID NOT NULL REFERENCES department_authority_levels(id) ON DELETE RESTRICT,
  to_authority_level_id    UUID NOT NULL REFERENCES department_authority_levels(id) ON DELETE RESTRICT,
  reason                   TEXT NOT NULL,
  notes                    TEXT,
  status                   VARCHAR(30) NOT NULL DEFAULT 'queued',
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  claimed_at               TIMESTAMPTZ,
  resulting_assignment_id  UUID REFERENCES request_assignments(id) ON DELETE RESTRICT,

  CONSTRAINT request_escalations_sequence_unique UNIQUE (request_id, sequence_no),
  CONSTRAINT request_escalations_sequence_positive CHECK (sequence_no >= 1),
  CONSTRAINT request_escalations_reason_not_blank CHECK (btrim(reason) <> ''),
  CONSTRAINT request_escalations_levels_differ
    CHECK (from_authority_level_id <> to_authority_level_id),
  CONSTRAINT request_escalations_status_allowed
    CHECK (status IN ('queued', 'claimed', 'cancelled')),
  CONSTRAINT request_escalations_claimed_consistency
    CHECK (
      (status = 'claimed' AND claimed_at IS NOT NULL AND resulting_assignment_id IS NOT NULL)
      OR (status <> 'claimed')
    ),
  CONSTRAINT request_escalations_composite_unique UNIQUE (id, request_id)
);

-- Ensure only one active (queued) escalation per request
CREATE UNIQUE INDEX uq_request_one_active_escalation
  ON request_escalations (request_id)
  WHERE status = 'queued';

COMMENT ON TABLE request_escalations IS
  'Queue-based escalation events moving requests across authority levels in a department.';
COMMENT ON COLUMN request_escalations.from_authority_level_id IS
  'Source authority tier where the request could not be resolved.';
COMMENT ON COLUMN request_escalations.to_authority_level_id IS
  'Destination authority queue where eligible higher-level staff may claim the request.';
COMMENT ON COLUMN request_escalations.resulting_assignment_id IS
  'Assignment created when an eligible staff member at the destination authority level claims the request.';

-- ---------------------------------------------------------------------------
