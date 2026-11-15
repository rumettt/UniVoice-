-- Shared SQL capacity mechanism used by request and assistance claim functions.
CREATE OR REPLACE FUNCTION assert_staff_assignment_capacity(
  p_staff_user_id UUID,
  p_department_id UUID
)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_available BOOLEAN;
  v_override INTEGER;
  v_default INTEGER;
  v_capacity INTEGER;
  v_active_count INTEGER;
BEGIN
  SELECT is_available, max_active_requests_override
    INTO v_available, v_override
  FROM staff_department_work_settings
  WHERE staff_user_id = p_staff_user_id
    AND department_id = p_department_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Work settings row missing for staff % in department %',
      p_staff_user_id, p_department_id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  IF NOT v_available THEN
    RAISE EXCEPTION 'Staff member % is unavailable in department %',
      p_staff_user_id, p_department_id
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;

  SELECT default_max_active_requests INTO v_default
  FROM departments
  WHERE id = p_department_id;

  v_capacity := COALESCE(v_override, v_default, 5);

  SELECT COUNT(*)::INTEGER INTO v_active_count
  FROM (
    SELECT ra.id
    FROM request_assignments ra
    WHERE ra.assignee_id = p_staff_user_id
      AND ra.department_id = p_department_id
      AND ra.ended_at IS NULL
    UNION ALL
    SELECT aa.id
    FROM request_assistance_assignments aa
    WHERE aa.staff_user_id = p_staff_user_id
      AND aa.department_id = p_department_id
      AND aa.ended_at IS NULL
  ) active_assignments;

  IF v_active_count >= v_capacity THEN
    RAISE EXCEPTION 'Staff member % is at capacity (% active assignments, limit is %)',
      p_staff_user_id, v_active_count, v_capacity
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN v_active_count;
END;
$$;

CREATE OR REPLACE FUNCTION protect_assistance_assignment_identity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.id IS DISTINCT FROM NEW.id
     OR OLD.task_id IS DISTINCT FROM NEW.task_id
     OR OLD.staff_user_id IS DISTINCT FROM NEW.staff_user_id
     OR OLD.department_id IS DISTINCT FROM NEW.department_id
     OR OLD.source IS DISTINCT FROM NEW.source
     OR OLD.started_at IS DISTINCT FROM NEW.started_at
     OR (OLD.ended_at IS NOT NULL AND OLD.ended_at IS DISTINCT FROM NEW.ended_at) THEN
    RAISE EXCEPTION 'Assistance assignment identity and ended intervals are immutable'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION protect_assistance_task_identity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL AND EXISTS (
    SELECT 1 FROM request_assistance_assignments aa WHERE aa.task_id = OLD.id
  ) THEN
    RAISE EXCEPTION 'A task with assignment history cannot be soft-deleted'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.deleted_at IS NOT NULL AND OLD.deleted_at IS DISTINCT FROM NEW.deleted_at THEN
    RAISE EXCEPTION 'Assistance task soft deletion is permanent'
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF OLD.parent_request_id IS DISTINCT FROM NEW.parent_request_id
     OR OLD.created_by_handler_id IS DISTINCT FROM NEW.created_by_handler_id
     OR OLD.parent_assignment_id IS DISTINCT FROM NEW.parent_assignment_id
     OR OLD.parent_origin_department_id IS DISTINCT FROM NEW.parent_origin_department_id
     OR OLD.parent_origin_category_id IS DISTINCT FROM NEW.parent_origin_category_id
     OR OLD.original_compatibility_id IS DISTINCT FROM NEW.original_compatibility_id
     OR OLD.original_supporting_department_id IS DISTINCT FROM NEW.original_supporting_department_id
     OR OLD.original_supporting_category_id IS DISTINCT FROM NEW.original_supporting_category_id
     OR OLD.original_supporting_authority_level_id IS DISTINCT FROM NEW.original_supporting_authority_level_id
     OR OLD.title IS DISTINCT FROM NEW.title
     OR OLD.description IS DISTINCT FROM NEW.description
     OR OLD.reason IS DISTINCT FROM NEW.reason
     OR OLD.priority IS DISTINCT FROM NEW.priority
     OR OLD.due_at IS DISTINCT FROM NEW.due_at
     OR (OLD.ever_claimed_at IS NOT NULL AND OLD.ever_claimed_at IS DISTINCT FROM NEW.ever_claimed_at)
     OR (OLD.closed_at IS NOT NULL AND OLD.closed_at IS DISTINCT FROM NEW.closed_at) THEN
    RAISE EXCEPTION 'Assistance task creation details are immutable'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION protect_assistance_compatibility_identity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.id IS DISTINCT FROM NEW.id
     OR OLD.origin_category_id IS DISTINCT FROM NEW.origin_category_id
     OR OLD.supporting_department_id IS DISTINCT FROM NEW.supporting_department_id
     OR OLD.supporting_category_id IS DISTINCT FROM NEW.supporting_category_id THEN
    RAISE EXCEPTION 'Compatibility route identity is immutable; deactivate the mapping instead'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION validate_assistance_task_route()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM department_category_compatibilities dcc
    JOIN departments d ON d.id = dcc.supporting_department_id AND d.is_active = TRUE
    JOIN categories c ON c.id = dcc.supporting_category_id AND c.is_active = TRUE
    JOIN department_authority_levels dal
      ON dal.id = NEW.supporting_authority_level_id
     AND dal.department_id = dcc.supporting_department_id
     AND dal.is_active = TRUE
    WHERE dcc.id = NEW.compatibility_id
      AND dcc.origin_category_id = NEW.parent_origin_category_id
      AND dcc.supporting_department_id = NEW.supporting_department_id
      AND dcc.supporting_category_id = NEW.supporting_category_id
      AND dcc.is_active = TRUE
  ) THEN
    RAISE EXCEPTION 'Assistance task route requires an active compatible department, category, and authority level'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION enforce_assistance_task_assignment_consistency()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_task_id UUID;
  v_status VARCHAR(20);
  v_department_id UUID;
  v_active_count INTEGER;
  v_active_department UUID;
BEGIN
  IF TG_TABLE_NAME = 'request_assistance_tasks' THEN
    v_task_id := NEW.id;
  ELSE
    v_task_id := NEW.task_id;
  END IF;

  SELECT status, supporting_department_id
    INTO v_status, v_department_id
  FROM request_assistance_tasks WHERE id = v_task_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT COUNT(*)::INTEGER, (array_agg(department_id))[1]
    INTO v_active_count, v_active_department
  FROM request_assistance_assignments
  WHERE task_id = v_task_id AND ended_at IS NULL;

  IF v_status IN ('assigned', 'in_progress') THEN
    IF v_active_count <> 1 OR v_active_department IS DISTINCT FROM v_department_id THEN
      RAISE EXCEPTION 'Task status % requires exactly one active assignment in its supporting department', v_status
        USING ERRCODE = 'check_violation';
    END IF;
  ELSIF v_active_count <> 0 THEN
    RAISE EXCEPTION 'Task status % cannot have an active assignment', v_status
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;

-- Make the database claim entry point authoritative even when called without
-- the application repository's earlier settings-row lock.
CREATE OR REPLACE FUNCTION claim_request(
  p_request_id UUID,
  p_staff_user_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  v_req requests%ROWTYPE;
  v_request_level_order SMALLINT;
  v_staff_level_order SMALLINT;
  v_assignment_id UUID;
  v_source VARCHAR(40);
  v_active_escalation_id UUID;
BEGIN
  SELECT * INTO v_req FROM requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Request % does not exist', p_request_id USING ERRCODE = 'no_data_found';
  END IF;
  IF v_req.deleted_at IS NOT NULL OR v_req.status <> 'pending' OR v_req.current_assignment_id IS NOT NULL THEN
    RAISE EXCEPTION 'Request % is not available to claim (status: %)', p_request_id, v_req.status
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM users u JOIN staff_profiles sp ON sp.user_id = u.id
    WHERE u.id = p_staff_user_id AND u.is_active = TRUE
  ) THEN
    RAISE EXCEPTION 'Staff member % is not active or has no staff profile', p_staff_user_id
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM staff_department_memberships
    WHERE staff_user_id = p_staff_user_id
      AND department_id = v_req.responsible_department_id
      AND (valid_to IS NULL OR valid_to > NOW())
  ) THEN
    RAISE EXCEPTION 'Staff member % is not an active member of department %',
      p_staff_user_id, v_req.responsible_department_id USING ERRCODE = 'invalid_authorization_specification';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM departments WHERE id = v_req.responsible_department_id AND is_active = TRUE) THEN
    RAISE EXCEPTION 'Department % is inactive', v_req.responsible_department_id
      USING ERRCODE = 'invalid_authorization_specification';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM staff_category_authorizations
    WHERE staff_user_id = p_staff_user_id AND category_id = v_req.category_id
      AND can_handle = TRUE AND (valid_to IS NULL OR valid_to > NOW())
  ) THEN
    RAISE EXCEPTION 'Staff member % is not authorized for category %', p_staff_user_id, v_req.category_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  PERFORM assert_staff_assignment_capacity(p_staff_user_id, v_req.responsible_department_id);

  SELECT level_order INTO v_request_level_order
  FROM department_authority_levels WHERE id = v_req.current_authority_level_id;
  SELECT dal.level_order INTO v_staff_level_order
  FROM staff_department_authority_levels sdal
  JOIN department_authority_levels dal ON dal.id = sdal.department_authority_level_id
  WHERE sdal.staff_user_id = p_staff_user_id
    AND sdal.department_id = v_req.responsible_department_id
    AND (sdal.valid_to IS NULL OR sdal.valid_to > NOW());
  IF v_staff_level_order IS NULL THEN
    RAISE EXCEPTION 'Staff member % has no active authority in department %',
      p_staff_user_id, v_req.responsible_department_id USING ERRCODE = 'invalid_authorization_specification';
  END IF;
  IF v_staff_level_order < v_request_level_order THEN
    RAISE EXCEPTION 'Staff authority level is insufficient' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_req.current_escalation_id IS NOT NULL THEN
    SELECT id INTO v_active_escalation_id FROM request_escalations
    WHERE id = v_req.current_escalation_id AND status = 'queued';
  END IF;
  v_source := CASE WHEN v_active_escalation_id IS NULL THEN 'claim' ELSE 'escalation_claim' END;

  INSERT INTO request_assignments (
    request_id, assignee_id, assigned_by, department_id, source, source_escalation_id, started_at
  ) VALUES (
    p_request_id, p_staff_user_id, p_staff_user_id, v_req.responsible_department_id,
    v_source, v_active_escalation_id, NOW()
  ) RETURNING id INTO v_assignment_id;

  IF v_active_escalation_id IS NOT NULL THEN
    UPDATE request_escalations SET status = 'claimed', claimed_at = NOW(), resulting_assignment_id = v_assignment_id
    WHERE id = v_active_escalation_id AND status = 'queued';
  END IF;

  UPDATE requests SET current_assignment_id = v_assignment_id, status = 'assigned',
    updated_by = p_staff_user_id, updated_at = NOW() WHERE id = p_request_id;
  INSERT INTO request_history (request_id, actor_id, action, field_name, old_value, new_value, details)
  VALUES (p_request_id, p_staff_user_id, 'claimed', 'current_assignment_id', NULL, v_assignment_id::text,
    jsonb_build_object('source', v_source,
      'request_authority_level_order', v_request_level_order,
      'staff_authority_level_order', v_staff_level_order));
  RETURN v_assignment_id;
END;
$$;
