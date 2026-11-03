-- =============================================================================
-- Migration: V001__queue_based_authority_architecture.sql
-- Description: Upgrades UniVoice schema from supervisor-based escalation to
--              department-specific authority queue routing, manual claiming,
--              and workload capacity management.
-- =============================================================================

BEGIN;

-- 1. Departments enhancements
ALTER TABLE departments
  ADD COLUMN IF NOT EXISTS default_max_active_requests INTEGER NOT NULL DEFAULT 5;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'departments_default_max_active_positive'
  ) THEN
    ALTER TABLE departments
      ADD CONSTRAINT departments_default_max_active_positive
      CHECK (default_max_active_requests > 0);
  END IF;
END $$;

-- 2. Department Authority Levels table
CREATE TABLE IF NOT EXISTS department_authority_levels (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id  UUID NOT NULL REFERENCES departments(id) ON DELETE RESTRICT,
  code           VARCHAR(40)  NOT NULL,
  name           VARCHAR(100) NOT NULL,
  level_order    SMALLINT     NOT NULL,
  description    TEXT,
  is_active      BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT dept_authority_levels_dept_code_unique UNIQUE (department_id, code),
  CONSTRAINT dept_authority_levels_dept_name_unique UNIQUE (department_id, name),
  CONSTRAINT dept_authority_levels_dept_order_unique UNIQUE (department_id, level_order),
  CONSTRAINT dept_authority_levels_order_positive CHECK (level_order >= 1),
  CONSTRAINT dept_authority_levels_composite_unique UNIQUE (id, department_id)
);

-- 3. Staff Department Authority Levels (effective-dated)
CREATE TABLE IF NOT EXISTS staff_department_authority_levels (
  id                            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_user_id                 UUID NOT NULL REFERENCES staff_profiles(user_id) ON DELETE RESTRICT,
  department_authority_level_id UUID NOT NULL REFERENCES department_authority_levels(id) ON DELETE RESTRICT,
  department_id                 UUID NOT NULL REFERENCES departments(id) ON DELETE RESTRICT,
  valid_from                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  valid_to                      TIMESTAMPTZ,
  created_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT staff_dept_auth_levels_range
    CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT staff_dept_auth_levels_dept_fk
    FOREIGN KEY (department_authority_level_id, department_id)
    REFERENCES department_authority_levels(id, department_id)
    ON DELETE RESTRICT,
  CONSTRAINT staff_dept_auth_levels_no_overlap
    EXCLUDE USING gist (
      staff_user_id WITH =,
      department_id WITH =,
      tstzrange(valid_from, COALESCE(valid_to, 'infinity'::timestamptz), '[)') WITH &&
    )
);

-- 4. Staff Work Settings (availability and capacity override)
CREATE TABLE IF NOT EXISTS staff_department_work_settings (
  id                           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_user_id                UUID NOT NULL REFERENCES staff_profiles(user_id) ON DELETE RESTRICT,
  department_id                UUID NOT NULL REFERENCES departments(id) ON DELETE RESTRICT,
  is_available                 BOOLEAN NOT NULL DEFAULT TRUE,
  max_active_requests_override INTEGER,
  created_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT staff_dept_work_settings_unique UNIQUE (staff_user_id, department_id),
  CONSTRAINT staff_dept_work_settings_override_positive
    CHECK (max_active_requests_override IS NULL OR max_active_requests_override > 0)
);

-- 5. Scope staff_position_holdings overlap constraint to department
ALTER TABLE staff_position_holdings
  DROP CONSTRAINT IF EXISTS staff_position_holdings_no_overlap;

ALTER TABLE staff_position_holdings
  ADD CONSTRAINT staff_position_holdings_no_overlap
  EXCLUDE USING gist (
    staff_user_id WITH =,
    department_id WITH =,
    tstzrange(valid_from, COALESCE(valid_to, 'infinity'::timestamptz), '[)') WITH &&
  );

-- 6. Categories update: link initial authority queue
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'categories_composite_dept_unique'
  ) THEN
    ALTER TABLE categories ADD CONSTRAINT categories_composite_dept_unique UNIQUE (id, department_id);
  END IF;
END $$;

ALTER TABLE categories
  ADD COLUMN IF NOT EXISTS initial_authority_level_id UUID;

-- 7. Requests update
ALTER TABLE requests
  ADD COLUMN IF NOT EXISTS current_authority_level_id UUID;

-- Remove obsolete approver column if present
ALTER TABLE requests
  DROP COLUMN IF EXISTS current_approver_id CASCADE;

-- Add description nonblank check and resolved timestamp check
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'requests_description_not_blank'
  ) THEN
    ALTER TABLE requests ADD CONSTRAINT requests_description_not_blank CHECK (btrim(description) <> '');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'requests_resolved_has_resolved_at'
  ) THEN
    ALTER TABLE requests ADD CONSTRAINT requests_resolved_has_resolved_at CHECK (status <> 'resolved' OR resolved_at IS NOT NULL);
  END IF;
END $$;

-- 8. Assignments update
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'request_assignments_req_id_unique'
  ) THEN
    ALTER TABLE request_assignments ADD CONSTRAINT request_assignments_req_id_unique UNIQUE (request_id, id);
  END IF;
END $$;

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
    'reopen'
  ));

-- 9. Request escalations table update to queue-based architecture
-- Drop obsolete indexes and foreign keys
ALTER TABLE requests DROP CONSTRAINT IF EXISTS requests_current_escalation_fk CASCADE;
ALTER TABLE request_assignments DROP CONSTRAINT IF EXISTS request_assignments_source_escalation_fk CASCADE;

-- Add new columns if missing
ALTER TABLE request_escalations
  ADD COLUMN IF NOT EXISTS from_authority_level_id UUID,
  ADD COLUMN IF NOT EXISTS to_authority_level_id UUID,
  ADD COLUMN IF NOT EXISTS notes TEXT,
  ADD COLUMN IF NOT EXISTS status VARCHAR(30) DEFAULT 'queued';

-- Drop obsolete recipient and supervision columns safely
ALTER TABLE request_escalations
  DROP COLUMN IF EXISTS to_staff_id CASCADE,
  DROP COLUMN IF EXISTS supervision_id CASCADE,
  DROP COLUMN IF EXISTS recipient_position_id CASCADE,
  DROP COLUMN IF EXISTS responsibility_model CASCADE,
  DROP COLUMN IF EXISTS acknowledgement_status CASCADE,
  DROP COLUMN IF EXISTS assistance_required CASCADE,
  DROP COLUMN IF EXISTS outcome CASCADE,
  DROP COLUMN IF EXISTS outcome_note CASCADE,
  DROP COLUMN IF EXISTS decided_by CASCADE,
  DROP COLUMN IF EXISTS decided_at CASCADE,
  DROP COLUMN IF EXISTS acknowledged_at CASCADE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'request_escalations_composite_unique'
  ) THEN
    ALTER TABLE request_escalations ADD CONSTRAINT request_escalations_composite_unique UNIQUE (id, request_id);
  END IF;
END $$;

-- 10. Re-bind cyclic constraints with composite keys
ALTER TABLE requests
  DROP CONSTRAINT IF EXISTS requests_current_assignment_fk;

ALTER TABLE requests
  ADD CONSTRAINT requests_current_assignment_fk
  FOREIGN KEY (id, current_assignment_id)
  REFERENCES request_assignments(request_id, id)
  ON DELETE RESTRICT
  DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE requests
  DROP CONSTRAINT IF EXISTS requests_current_escalation_fk;

ALTER TABLE requests
  ADD CONSTRAINT requests_current_escalation_fk
  FOREIGN KEY (current_escalation_id, id)
  REFERENCES request_escalations(id, request_id)
  ON DELETE RESTRICT
  DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE request_assignments
  DROP CONSTRAINT IF EXISTS request_assignments_source_escalation_fk;

ALTER TABLE request_assignments
  ADD CONSTRAINT request_assignments_source_escalation_fk
  FOREIGN KEY (source_escalation_id)
  REFERENCES request_escalations(id)
  ON DELETE RESTRICT
  DEFERRABLE INITIALLY DEFERRED;

COMMIT;
