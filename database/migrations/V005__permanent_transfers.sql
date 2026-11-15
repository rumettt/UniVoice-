-- ============================================================================
-- Migration: V005__permanent_transfers.sql
-- Description: Phase 7 Milestone 3: Permanent Transfers
-- ============================================================================

-- 1. Add initial_category_id to requests table to preserve original student classification immutably
ALTER TABLE requests
  ADD COLUMN IF NOT EXISTS initial_category_id UUID REFERENCES categories(id) ON DELETE RESTRICT;

-- Backfill initial_category_id with category_id for all existing rows
UPDATE requests
SET initial_category_id = category_id
WHERE initial_category_id IS NULL;

-- Set NOT NULL constraint
ALTER TABLE requests
  ALTER COLUMN initial_category_id SET NOT NULL;

-- Enforce immutability of initial_category_id via trigger
CREATE OR REPLACE FUNCTION protect_request_initial_category()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.initial_category_id IS DISTINCT FROM NEW.initial_category_id THEN
    RAISE EXCEPTION 'initial_category_id is immutable once submitted and cannot be changed'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_requests_protect_initial_category ON requests;
CREATE TRIGGER trg_requests_protect_initial_category
  BEFORE UPDATE ON requests
  FOR EACH ROW
  EXECUTE FUNCTION protect_request_initial_category();

-- 2. Extend request_assignments source constraint to permit 'transfer'
ALTER TABLE request_assignments
  DROP CONSTRAINT IF EXISTS request_assignments_source_allowed;

ALTER TABLE request_assignments
  ADD CONSTRAINT request_assignments_source_allowed
    CHECK (source IN (
      'claim',
      'escalation_claim',
      'initial',
      'reassignment',
      'system_assigned',
      'reopen',
      'transfer'
    ));

-- 3. Create request_transfers table
CREATE TABLE IF NOT EXISTS request_transfers (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id                  UUID NOT NULL REFERENCES requests(id) ON DELETE RESTRICT,
  sequence_no                 INTEGER NOT NULL,
  from_department_id          UUID NOT NULL REFERENCES departments(id) ON DELETE RESTRICT,
  to_department_id            UUID NOT NULL REFERENCES departments(id) ON DELETE RESTRICT,
  from_category_id            UUID NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  to_category_id              UUID NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  from_authority_level_id     UUID NOT NULL REFERENCES department_authority_levels(id) ON DELETE RESTRICT,
  to_authority_level_id       UUID NOT NULL REFERENCES department_authority_levels(id) ON DELETE RESTRICT,
  initiated_by                UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  initiated_assignment_id     UUID REFERENCES request_assignments(id) ON DELETE RESTRICT,
  reason                      TEXT NOT NULL,
  status                      VARCHAR(30) NOT NULL DEFAULT 'pending',
  decided_by                  UUID REFERENCES users(id) ON DELETE RESTRICT,
  decided_at                  TIMESTAMPTZ,
  rejection_reason            TEXT,
  cancellation_reason         TEXT,
  cancelled_at                TIMESTAMPTZ,
  cancelled_by                UUID REFERENCES users(id) ON DELETE RESTRICT,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT request_transfers_sequence_unique UNIQUE (request_id, sequence_no),
  CONSTRAINT request_transfers_sequence_positive CHECK (sequence_no >= 1),
  CONSTRAINT request_transfers_reason_not_blank CHECK (btrim(reason) <> ''),
  CONSTRAINT request_transfers_departments_differ CHECK (from_department_id <> to_department_id),
  CONSTRAINT request_transfers_status_allowed CHECK (status IN ('pending', 'accepted', 'rejected', 'cancelled')),
  CONSTRAINT request_transfers_rejection_reason CHECK (status <> 'rejected' OR btrim(COALESCE(rejection_reason, '')) <> ''),
  CONSTRAINT request_transfers_cancellation_reason CHECK (status <> 'cancelled' OR btrim(COALESCE(cancellation_reason, '')) <> ''),
  CONSTRAINT request_transfers_decided_consistency CHECK (
    (status IN ('accepted', 'rejected') AND decided_at IS NOT NULL AND decided_by IS NOT NULL)
    OR (status NOT IN ('accepted', 'rejected'))
  ),
  CONSTRAINT request_transfers_cancelled_consistency CHECK (
    (status = 'cancelled' AND cancelled_at IS NOT NULL)
    OR (status <> 'cancelled')
  ),
  CONSTRAINT request_transfers_to_category_dept_fk
    FOREIGN KEY (to_category_id, to_department_id)
    REFERENCES categories(id, department_id) ON DELETE RESTRICT,
  CONSTRAINT request_transfers_to_auth_level_dept_fk
    FOREIGN KEY (to_authority_level_id, to_department_id)
    REFERENCES department_authority_levels(id, department_id) ON DELETE RESTRICT,
  CONSTRAINT request_transfers_from_category_dept_fk
    FOREIGN KEY (from_category_id, from_department_id)
    REFERENCES categories(id, department_id) ON DELETE RESTRICT,
  CONSTRAINT request_transfers_from_auth_level_dept_fk
    FOREIGN KEY (from_authority_level_id, from_department_id)
    REFERENCES department_authority_levels(id, department_id) ON DELETE RESTRICT
);

-- At most one pending transfer per request at any given time
CREATE UNIQUE INDEX IF NOT EXISTS uq_request_one_pending_transfer
  ON request_transfers (request_id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_request_transfers_to_dept_pending
  ON request_transfers (to_department_id, created_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_request_transfers_request
  ON request_transfers (request_id, sequence_no);

-- Set updated_at trigger for request_transfers
DROP TRIGGER IF EXISTS trg_request_transfers_updated_at ON request_transfers;
CREATE TRIGGER trg_request_transfers_updated_at
  BEFORE UPDATE ON request_transfers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 4. Invalidation trigger function: automatically cancel pending transfers on lifecycle/assignment disruption
CREATE OR REPLACE FUNCTION invalidate_pending_transfer_on_request_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_pending_transfer RECORD;
  v_cancel_reason    TEXT;
BEGIN
  -- Look for an active pending transfer for this request
  SELECT id, sequence_no INTO v_pending_transfer
  FROM request_transfers
  WHERE request_id = NEW.id AND status = 'pending';

  IF FOUND THEN
    -- If status transitioned to resolved, closed, rejected, or pending (returned/escalated)
    -- without going through transfer_accepted
    IF (OLD.status IN ('assigned', 'in_progress') AND NEW.status IN ('pending', 'resolved', 'closed', 'rejected'))
       OR (OLD.current_assignment_id IS NOT NULL AND NEW.current_assignment_id IS NULL AND NEW.responsible_department_id = OLD.responsible_department_id)
    THEN
      v_cancel_reason := 'Request state changed to ''' || NEW.status || ''' by actor ' || COALESCE(NEW.updated_by::text, 'system');
      
      UPDATE request_transfers
      SET status = 'cancelled',
          cancellation_reason = v_cancel_reason,
          cancelled_at = NOW(),
          cancelled_by = NEW.updated_by,
          updated_at = NOW()
      WHERE id = v_pending_transfer.id;

      INSERT INTO request_history (
        request_id, actor_id, action, field_name, old_value, new_value, details
      ) VALUES (
        NEW.id,
        NEW.updated_by,
        'transfer_cancelled',
        'status',
        'pending',
        'cancelled',
        jsonb_build_object(
          'transfer_id', v_pending_transfer.id,
          'reason', v_cancel_reason,
          'trigger_status', NEW.status
        )
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_requests_invalidate_pending_transfer ON requests;
CREATE TRIGGER trg_requests_invalidate_pending_transfer
  BEFORE UPDATE OF status, current_assignment_id
  ON requests
  FOR EACH ROW
  EXECUTE FUNCTION invalidate_pending_transfer_on_request_change();
