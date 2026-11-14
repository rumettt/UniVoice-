-- =============================================================================
-- Migration: V002__request_workflow.sql
-- Description: Adds request workflow fields (resolution category, rejection reason,
--              reopen count, first closure timestamp), system settings table,
--              and enriched lifecycle history triggers for Phase 6.
-- =============================================================================

BEGIN;

-- 1. Global System Settings Table
CREATE TABLE IF NOT EXISTS system_settings (
  key         VARCHAR(64) PRIMARY KEY,
  value       JSONB NOT NULL,
  description TEXT,
  updated_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE system_settings IS
  'Global dynamic platform configurations managed by administrators.';

INSERT INTO system_settings (key, value, description)
VALUES
  ('request_workflow.reopen_window_days', '{"days": 7}'::jsonb, 'Global request reopening time window in days'),
  ('request_workflow.max_reopen_count', '{"max": 2}'::jsonb, 'Maximum number of times a student may reopen a closed request')
ON CONFLICT (key) DO NOTHING;

-- 2. Request Workflow Columns
ALTER TABLE requests
  ADD COLUMN IF NOT EXISTS reopen_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS resolution_category VARCHAR(100),
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT,
  ADD COLUMN IF NOT EXISTS first_closed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_reopen_reason TEXT;

-- 3. Check Constraints
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'requests_reopen_count_nonnegative'
  ) THEN
    ALTER TABLE requests ADD CONSTRAINT requests_reopen_count_nonnegative CHECK (reopen_count >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'requests_resolution_category_allowed'
  ) THEN
    ALTER TABLE requests ADD CONSTRAINT requests_resolution_category_allowed
      CHECK (resolution_category IS NULL OR resolution_category IN (
        'resolved_fully',
        'workaround_provided',
        'information_provided',
        'referred_to_external',
        'other'
      ));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'requests_resolved_has_category'
  ) THEN
    ALTER TABLE requests ADD CONSTRAINT requests_resolved_has_category
      CHECK (status <> 'resolved' OR resolution_category IS NOT NULL);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'requests_resolved_has_notes'
  ) THEN
    ALTER TABLE requests ADD CONSTRAINT requests_resolved_has_notes
      CHECK (status <> 'resolved' OR btrim(COALESCE(resolution_notes, '')) <> '');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'requests_rejected_has_reason'
  ) THEN
    ALTER TABLE requests ADD CONSTRAINT requests_rejected_has_reason
      CHECK (status <> 'rejected' OR btrim(COALESCE(rejection_reason, '')) <> '');
  END IF;
END $$;

-- 4. Update request lifecycle trigger function with contextual details
CREATE OR REPLACE FUNCTION record_request_lifecycle_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO request_history (
      request_id, actor_id, action, field_name, old_value, new_value, details
    ) VALUES (
      NEW.id,
      NEW.created_by,
      'submitted',
      'status',
      NULL,
      NEW.status,
      jsonb_build_object(
        'source', 'insert',
        'department_id', NEW.responsible_department_id,
        'authority_level_id', NEW.current_authority_level_id
      )
    );
    RETURN NEW;
  END IF;

  IF OLD.status IS DISTINCT FROM NEW.status THEN
    DECLARE
      v_details jsonb;
    BEGIN
      IF NEW.status = 'in_progress' AND OLD.status = 'assigned' THEN
        v_details := jsonb_build_object('source', 'start_processing');
      ELSIF NEW.status = 'resolved' THEN
        v_details := jsonb_build_object(
          'source', 'resolve',
          'resolution_category', NEW.resolution_category,
          'resolution_notes', NEW.resolution_notes,
          'resolved_at', NEW.resolved_at
        );
      ELSIF NEW.status = 'closed' THEN
        v_details := jsonb_build_object(
          'source', 'close',
          'closed_at', NEW.closed_at,
          'first_closed_at', NEW.first_closed_at
        );
      ELSIF NEW.status = 'rejected' THEN
        v_details := jsonb_build_object(
          'source', 'reject',
          'rejection_reason', NEW.rejection_reason,
          'rejected_at', NEW.rejected_at
        );
      ELSIF OLD.status = 'closed' AND NEW.status = 'pending' THEN
        v_details := jsonb_build_object(
          'source', 'reopen',
          'reopen_count', NEW.reopen_count,
          'reopen_reason', NEW.last_reopen_reason,
          'authority_level_id', NEW.current_authority_level_id
        );
      ELSE
        v_details := jsonb_build_object('source', 'update');
      END IF;

      INSERT INTO request_history (
        request_id, actor_id, action, field_name, old_value, new_value, details
      ) VALUES (
        NEW.id,
        NEW.updated_by,
        'status_changed',
        'status',
        OLD.status,
        NEW.status,
        v_details
      );
    END;
  END IF;

  IF OLD.priority IS DISTINCT FROM NEW.priority THEN
    INSERT INTO request_history (
      request_id, actor_id, action, field_name, old_value, new_value, details
    ) VALUES (
      NEW.id,
      NEW.updated_by,
      'priority_changed',
      'priority',
      OLD.priority,
      NEW.priority,
      jsonb_build_object('source', 'update')
    );
  END IF;

  IF OLD.responsible_department_id IS DISTINCT FROM NEW.responsible_department_id THEN
    INSERT INTO request_history (
      request_id, actor_id, action, field_name, old_value, new_value, details
    ) VALUES (
      NEW.id,
      NEW.updated_by,
      'department_changed',
      'responsible_department_id',
      OLD.responsible_department_id::text,
      NEW.responsible_department_id::text,
      jsonb_build_object('source', 'update')
    );
  END IF;

  IF OLD.current_authority_level_id IS DISTINCT FROM NEW.current_authority_level_id THEN
    INSERT INTO request_history (
      request_id, actor_id, action, field_name, old_value, new_value, details
    ) VALUES (
      NEW.id,
      NEW.updated_by,
      'authority_level_changed',
      'current_authority_level_id',
      OLD.current_authority_level_id::text,
      NEW.current_authority_level_id::text,
      jsonb_build_object('source', 'update')
    );
  END IF;

  RETURN NEW;
END;
$$;

COMMIT;
