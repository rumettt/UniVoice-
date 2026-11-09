-- 14. Reusable trigger and procedural workflow functions
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION prevent_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    '% records are append-only and cannot be updated or deleted',
    TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE OR REPLACE FUNCTION protect_assignment_identity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.id IS DISTINCT FROM NEW.id
     OR OLD.request_id IS DISTINCT FROM NEW.request_id
     OR OLD.assignee_id IS DISTINCT FROM NEW.assignee_id
     OR OLD.assigned_by IS DISTINCT FROM NEW.assigned_by
     OR OLD.department_id IS DISTINCT FROM NEW.department_id
     OR OLD.source IS DISTINCT FROM NEW.source
     OR OLD.source_escalation_id IS DISTINCT FROM NEW.source_escalation_id
     OR OLD.started_at IS DISTINCT FROM NEW.started_at
     OR OLD.created_at IS DISTINCT FROM NEW.created_at
  THEN
    RAISE EXCEPTION 'Assignment identity fields cannot be changed; only ended_at may be updated'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION protect_escalation_identity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.id IS DISTINCT FROM NEW.id
     OR OLD.request_id IS DISTINCT FROM NEW.request_id
     OR OLD.sequence_no IS DISTINCT FROM NEW.sequence_no
     OR OLD.initiated_by IS DISTINCT FROM NEW.initiated_by
     OR OLD.from_assignment_id IS DISTINCT FROM NEW.from_assignment_id
     OR OLD.from_authority_level_id IS DISTINCT FROM NEW.from_authority_level_id
     OR OLD.to_authority_level_id IS DISTINCT FROM NEW.to_authority_level_id
     OR OLD.reason IS DISTINCT FROM NEW.reason
     OR OLD.created_at IS DISTINCT FROM NEW.created_at
  THEN
    RAISE EXCEPTION 'Escalation identity fields cannot be changed after creation'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;

-- Hierarchy cycle prevention with transaction-level serialization advisory lock
CREATE OR REPLACE FUNCTION prevent_supervision_cycle()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  found_cycle boolean;
BEGIN
  IF NEW.supervisee_id = NEW.supervisor_id THEN
    RAISE EXCEPTION 'A staff member cannot supervise themselves'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Closed historical rows do not change the live graph
  IF NEW.valid_to IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Serialize live hierarchy validation across concurrent transactions
  PERFORM pg_advisory_xact_lock(hashtext('staff_supervisions_cycle_check'));

  WITH RECURSIVE chain AS (
    SELECT NEW.supervisor_id AS staff_id, 1 AS depth
    UNION ALL
    SELECT s.supervisor_id, chain.depth + 1
    FROM chain
    INNER JOIN staff_supervisions s
      ON s.supervisee_id = chain.staff_id
     AND s.valid_to IS NULL
     AND s.id IS DISTINCT FROM NEW.id
    WHERE chain.depth < 64
  )
  SELECT EXISTS (
    SELECT 1 FROM chain WHERE staff_id = NEW.supervisee_id
  ) INTO found_cycle;

  IF found_cycle THEN
    RAISE EXCEPTION 'Circular supervisory relationship is not allowed'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION protect_supervision_identity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.supervisee_id IS DISTINCT FROM NEW.supervisee_id
     OR OLD.supervisor_id IS DISTINCT FROM NEW.supervisor_id
     OR OLD.valid_from IS DISTINCT FROM NEW.valid_from
     OR OLD.created_at IS DISTINCT FROM NEW.created_at
  THEN
    RAISE EXCEPTION 'Close the current supervision row and insert a new one instead of rewriting it'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;

-- Tracks core request lifecycle transitions in request_history
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
    INSERT INTO request_history (
      request_id, actor_id, action, field_name, old_value, new_value, details
    ) VALUES (
      NEW.id,
      NEW.updated_by,
      'status_changed',
      'status',
      OLD.status,
      NEW.status,
      jsonb_build_object('source', 'update')
    );
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

-- =============================================================================
-- Core Procedural Functions (Claiming, Queue Escalation, Workload Management)
-- =============================================================================

-- Atomically claims a request from an authority queue
CREATE OR REPLACE FUNCTION claim_request(
  p_request_id    UUID,
  p_staff_user_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  v_req                  requests%ROWTYPE;
  v_is_available         BOOLEAN;
  v_max_override         INTEGER;
  v_dept_default_max     INTEGER;
  v_effective_capacity   INTEGER;
  v_active_count         INTEGER;
  v_request_level_order  SMALLINT;
  v_staff_level_order    SMALLINT;
  v_assignment_id        UUID;
  v_source               VARCHAR(40);
BEGIN
  -- 1. Row-level lock on the request to prevent concurrent claiming race conditions
  SELECT * INTO v_req
  FROM requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Request % does not exist', p_request_id
      USING ERRCODE = 'no_data_found';
  END IF;

  IF v_req.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Request % has been deleted', p_request_id
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;

  IF v_req.status <> 'pending' OR v_req.current_assignment_id IS NOT NULL THEN
    RAISE EXCEPTION 'Request % is not available to claim (status: %)', p_request_id, v_req.status
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;

  -- 2. Verify staff identity and active status
  IF NOT EXISTS (
    SELECT 1 FROM users u
    JOIN staff_profiles sp ON sp.user_id = u.id
    WHERE u.id = p_staff_user_id AND u.is_active = TRUE
  ) THEN
    RAISE EXCEPTION 'Staff member % is not active or has no staff profile', p_staff_user_id
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- 3. Verify staff belongs to the request department
  IF NOT EXISTS (
    SELECT 1 FROM staff_department_memberships
    WHERE staff_user_id = p_staff_user_id
      AND department_id = v_req.responsible_department_id
      AND (valid_to IS NULL OR valid_to > NOW())
  ) THEN
    RAISE EXCEPTION 'Staff member % is not an active member of department %',
      p_staff_user_id, v_req.responsible_department_id
      USING ERRCODE = 'invalid_authorization_specification';
  END IF;

  -- 3a. Verify the responsible department is still active
  IF NOT EXISTS (
    SELECT 1 FROM departments
    WHERE id = v_req.responsible_department_id
      AND is_active = TRUE
  ) THEN
    RAISE EXCEPTION 'Department % is no longer active and cannot accept new claims',
      v_req.responsible_department_id
      USING ERRCODE = 'invalid_authorization_specification';
  END IF;

  -- 4. Verify staff category authorization
  IF NOT EXISTS (
    SELECT 1 FROM staff_category_authorizations
    WHERE staff_user_id = p_staff_user_id
      AND category_id = v_req.category_id
      AND can_handle = TRUE
      AND (valid_to IS NULL OR valid_to > NOW())
  ) THEN
    RAISE EXCEPTION 'Staff member % is not authorized to handle category %',
      p_staff_user_id, v_req.category_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- 5. Verify availability
  SELECT is_available, max_active_requests_override
  INTO v_is_available, v_max_override
  FROM staff_department_work_settings
  WHERE staff_user_id = p_staff_user_id
    AND department_id = v_req.responsible_department_id;

  IF v_is_available IS FALSE THEN
    RAISE EXCEPTION 'Staff member % is currently marked unavailable in department %',
      p_staff_user_id, v_req.responsible_department_id
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;

  -- 6. Verify workload capacity against department default or individual override
  SELECT default_max_active_requests INTO v_dept_default_max
  FROM departments
  WHERE id = v_req.responsible_department_id;

  v_effective_capacity := COALESCE(v_max_override, v_dept_default_max, 5);

  SELECT COUNT(*) INTO v_active_count
  FROM request_assignments
  WHERE assignee_id = p_staff_user_id
    AND department_id = v_req.responsible_department_id
    AND ended_at IS NULL;

  IF v_active_count >= v_effective_capacity THEN
    RAISE EXCEPTION 'Staff member % is at capacity (% active requests, limit is %)',
      p_staff_user_id, v_active_count, v_effective_capacity
      USING ERRCODE = 'check_violation';
  END IF;

  -- 7. Verify Authority Level Eligibility (Threshold Rule: staff order >= request order)
  SELECT level_order INTO v_request_level_order
  FROM department_authority_levels
  WHERE id = v_req.current_authority_level_id;

  SELECT dal.level_order INTO v_staff_level_order
  FROM staff_department_authority_levels sdal
  JOIN department_authority_levels dal ON dal.id = sdal.department_authority_level_id
  WHERE sdal.staff_user_id = p_staff_user_id
    AND sdal.department_id = v_req.responsible_department_id
    AND (sdal.valid_to IS NULL OR sdal.valid_to > NOW());

  IF v_staff_level_order IS NULL THEN
    RAISE EXCEPTION 'Staff member % has no active authority level in department %',
      p_staff_user_id, v_req.responsible_department_id
      USING ERRCODE = 'invalid_authorization_specification';
  END IF;

  IF v_staff_level_order < v_request_level_order THEN
    RAISE EXCEPTION 'Staff authority level order (%) is insufficient for request authority level order (%)',
      v_staff_level_order, v_request_level_order
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- 8. Create assignment record
  IF v_req.current_escalation_id IS NOT NULL THEN
    v_source := 'escalation_claim';
  ELSE
    v_source := 'claim';
  END IF;

  INSERT INTO request_assignments (
    request_id, assignee_id, assigned_by, department_id, source, source_escalation_id, started_at
  ) VALUES (
    p_request_id, p_staff_user_id, p_staff_user_id, v_req.responsible_department_id,
    v_source, v_req.current_escalation_id, NOW()
  ) RETURNING id INTO v_assignment_id;

  -- 9. If request was queued under an escalation, complete that escalation
  IF v_req.current_escalation_id IS NOT NULL THEN
    UPDATE request_escalations
    SET status = 'claimed',
        claimed_at = NOW(),
        resulting_assignment_id = v_assignment_id
    WHERE id = v_req.current_escalation_id
      AND status = 'queued';
  END IF;

  -- 10. Update the request state
  UPDATE requests
  SET current_assignment_id = v_assignment_id,
      status = 'assigned',
      updated_by = p_staff_user_id,
      updated_at = NOW()
  WHERE id = p_request_id;

  -- 11. Record claiming in request_history
  INSERT INTO request_history (
    request_id, actor_id, action, field_name, old_value, new_value, details
  ) VALUES (
    p_request_id, p_staff_user_id, 'claimed', 'current_assignment_id', NULL, v_assignment_id::text,
    jsonb_build_object(
      'source', v_source,
      'request_authority_level_order', v_request_level_order,
      'staff_authority_level_order', v_staff_level_order
    )
  );

  RETURN v_assignment_id;
END;
$$;

-- Escalates a request to the next higher authority level queue in the department
CREATE OR REPLACE FUNCTION escalate_request_to_queue(
  p_request_id    UUID,
  p_staff_user_id UUID,
  p_reason        TEXT,
  p_notes         TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  v_req                  requests%ROWTYPE;
  v_current_assignment   request_assignments%ROWTYPE;
  v_current_level_order  SMALLINT;
  v_next_level_id        UUID;
  v_next_level_order     SMALLINT;
  v_seq                  INTEGER;
  v_escalation_id        UUID;
BEGIN
  IF btrim(COALESCE(p_reason, '')) = '' THEN
    RAISE EXCEPTION 'Escalation reason cannot be blank'
      USING ERRCODE = 'check_violation';
  END IF;

  -- 1. Row-level lock on request
  SELECT * INTO v_req
  FROM requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Request % does not exist', p_request_id
      USING ERRCODE = 'no_data_found';
  END IF;

  IF v_req.status NOT IN ('assigned', 'in_progress') OR v_req.current_assignment_id IS NULL THEN
    RAISE EXCEPTION 'Only actively assigned requests can be escalated (current status: %)', v_req.status
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;

  -- 2. Verify initiating staff is the current assignee
  SELECT * INTO v_current_assignment
  FROM request_assignments
  WHERE id = v_req.current_assignment_id;

  IF v_current_assignment.assignee_id <> p_staff_user_id THEN
    RAISE EXCEPTION 'Only the currently assigned staff member can escalate this request'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- 3. Determine current authority level order
  SELECT level_order INTO v_current_level_order
  FROM department_authority_levels
  WHERE id = v_req.current_authority_level_id;

  -- 4. Find the next higher authority level in this department
  SELECT id, level_order INTO v_next_level_id, v_next_level_order
  FROM department_authority_levels
  WHERE department_id = v_req.responsible_department_id
    AND is_active = TRUE
    AND level_order > v_current_level_order
  ORDER BY level_order ASC
  LIMIT 1;

  -- Confirmed Policy: Raise exception if already at highest authority level
  IF v_next_level_id IS NULL THEN
    RAISE EXCEPTION 'Request is already at the highest authority level for this department'
      USING ERRCODE = 'check_violation';
  END IF;

  -- 5. End current assignment
  UPDATE request_assignments
  SET ended_at = NOW()
  WHERE id = v_req.current_assignment_id;

  -- 6. Sequence number for escalation record
  SELECT COALESCE(MAX(sequence_no), 0) + 1 INTO v_seq
  FROM request_escalations
  WHERE request_id = p_request_id;

  -- 7. Insert queue escalation record
  INSERT INTO request_escalations (
    request_id, sequence_no, initiated_by, from_assignment_id,
    from_authority_level_id, to_authority_level_id, reason, notes, status
  ) VALUES (
    p_request_id, v_seq, p_staff_user_id, v_req.current_assignment_id,
    v_req.current_authority_level_id, v_next_level_id, p_reason, p_notes, 'queued'
  ) RETURNING id INTO v_escalation_id;

  -- 8. Move request to destination authority queue
  UPDATE requests
  SET current_authority_level_id = v_next_level_id,
      current_assignment_id = NULL,
      current_escalation_id = v_escalation_id,
      status = 'pending',
      updated_by = p_staff_user_id,
      updated_at = NOW()
  WHERE id = p_request_id;

  -- 9. Record in request_history
  INSERT INTO request_history (
    request_id, actor_id, action, field_name, old_value, new_value, details
  ) VALUES (
    p_request_id, p_staff_user_id, 'escalated', 'current_authority_level_id',
    v_req.current_authority_level_id::text, v_next_level_id::text,
    jsonb_build_object(
      'escalation_id', v_escalation_id,
      'sequence_no', v_seq,
      'from_level_order', v_current_level_order,
      'to_level_order', v_next_level_order,
      'reason', p_reason
    )
  );

  RETURN v_escalation_id;
END;
$$;

-- Marks a staff member unavailable and returns all their active requests to their authority queues
CREATE OR REPLACE FUNCTION set_staff_unavailable(
  p_staff_user_id UUID,
  p_department_id UUID
)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_rec            RECORD;
  v_returned_count INTEGER := 0;
BEGIN
  -- 1. Update or insert work settings to set unavailable
  INSERT INTO staff_department_work_settings (
    staff_user_id, department_id, is_available
  ) VALUES (
    p_staff_user_id, p_department_id, FALSE
  )
  ON CONFLICT (staff_user_id, department_id)
  DO UPDATE SET is_available = FALSE, updated_at = NOW();

  -- 2. Find and release all unfinished assignments in this department
  FOR v_rec IN
    SELECT r.id AS request_id, r.current_assignment_id, r.current_authority_level_id
    FROM requests r
    JOIN request_assignments ra ON ra.id = r.current_assignment_id
    WHERE ra.assignee_id = p_staff_user_id
      AND r.responsible_department_id = p_department_id
      AND ra.ended_at IS NULL
      AND r.status IN ('assigned', 'in_progress')
    FOR UPDATE OF r
  LOOP
    -- End the assignment
    UPDATE request_assignments
    SET ended_at = NOW()
    WHERE id = v_rec.current_assignment_id;

    -- Return request to queue preserving its current authority level
    UPDATE requests
    SET current_assignment_id = NULL,
        status = 'pending',
        updated_by = p_staff_user_id,
        updated_at = NOW()
    WHERE id = v_rec.request_id;

    -- Record in history
    INSERT INTO request_history (
      request_id, actor_id, action, field_name, old_value, new_value, details
    ) VALUES (
      v_rec.request_id, p_staff_user_id, 'returned_to_queue', 'current_assignment_id',
      v_rec.current_assignment_id::text, NULL,
      jsonb_build_object(
        'reason', 'staff_unavailable',
        'authority_level_id', v_rec.current_authority_level_id
      )
    );

    v_returned_count := v_returned_count + 1;
  END LOOP;

  RETURN v_returned_count;
END;
$$;

-- ---------------------------------------------------------------------------
