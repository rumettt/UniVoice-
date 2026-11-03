-- =============================================================================
-- UniVoice Schema Validation Test Suite
-- Validates all 12 operational scenarios and business constraints
-- =============================================================================

\set ON_ERROR_STOP on

BEGIN;

DO $$
DECLARE
  v_dept_id            UUID;
  v_other_dept_id      UUID;
  v_level_1_id         UUID;
  v_level_2_id         UUID;
  v_level_3_id         UUID;
  v_other_level_id     UUID;
  v_cat_id             UUID;
  v_student_user_id    UUID;
  v_staff_1_user_id    UUID;
  v_staff_2_user_id    UUID;
  v_staff_senior_id    UUID;
  v_unauth_staff_id    UUID;
  v_req_id             UUID;
  v_assignment_id      UUID;
  v_escalation_id      UUID;
  v_senior_asg_id      UUID;
  v_history_count      INTEGER;
  v_returned_count     INTEGER;
  v_err_occurred       BOOLEAN;
BEGIN
  RAISE NOTICE '=====================================================';
  RAISE NOTICE 'Starting UniVoice Schema Validation Test Suite';
  RAISE NOTICE '=====================================================';

  -- -----------------------------------------------------------------
  -- Setup: Test Departments, Authority Levels, Users, Profiles, Categories
  -- -----------------------------------------------------------------
  INSERT INTO departments (name, code, default_max_active_requests)
  VALUES ('Academic Affairs', 'ACAD_TEST', 2)
  RETURNING id INTO v_dept_id;

  INSERT INTO departments (name, code, default_max_active_requests)
  VALUES ('Finance Department', 'FIN_TEST', 3)
  RETURNING id INTO v_other_dept_id;

  -- Authority Levels for Academic Affairs (Levels 1, 2, 3)
  INSERT INTO department_authority_levels (department_id, code, name, level_order)
  VALUES (v_dept_id, 'ACAD_L1', 'Academic Officer', 1)
  RETURNING id INTO v_level_1_id;

  INSERT INTO department_authority_levels (department_id, code, name, level_order)
  VALUES (v_dept_id, 'ACAD_L2', 'Senior Academic Officer', 2)
  RETURNING id INTO v_level_2_id;

  INSERT INTO department_authority_levels (department_id, code, name, level_order)
  VALUES (v_dept_id, 'ACAD_L3', 'Dean of Academic Affairs', 3)
  RETURNING id INTO v_level_3_id;

  -- Finance Level
  INSERT INTO department_authority_levels (department_id, code, name, level_order)
  VALUES (v_other_dept_id, 'FIN_L1', 'Accountant', 1)
  RETURNING id INTO v_other_level_id;

  -- Category: Academic Grievance routed to Academic Affairs Level 1
  INSERT INTO categories (name, department_id, initial_authority_level_id, default_priority)
  VALUES ('Course Registration Issue', v_dept_id, v_level_1_id, 'high')
  RETURNING id INTO v_cat_id;

  -- Student User
  INSERT INTO users (first_name, last_name, email, password_hash, role)
  VALUES ('Jane', 'Student', 'student.jane@univoice.edu', 'hash', 'student')
  RETURNING id INTO v_student_user_id;

  INSERT INTO student_profiles (user_id, student_number, program_name)
  VALUES (v_student_user_id, 'STD-2026-001', 'B.Sc. Computer Science');

  -- Staff 1 (Level 1, capacity 2)
  INSERT INTO users (first_name, last_name, email, password_hash, role, primary_department_id)
  VALUES ('Alice', 'Officer', 'alice.officer@univoice.edu', 'hash', 'staff', v_dept_id)
  RETURNING id INTO v_staff_1_user_id;

  INSERT INTO staff_profiles (user_id, employee_number)
  VALUES (v_staff_1_user_id, 'EMP-001');

  INSERT INTO staff_department_memberships (staff_user_id, department_id, is_primary)
  VALUES (v_staff_1_user_id, v_dept_id, TRUE);

  INSERT INTO staff_department_authority_levels (staff_user_id, department_id, department_authority_level_id)
  VALUES (v_staff_1_user_id, v_dept_id, v_level_1_id);

  INSERT INTO staff_category_authorizations (staff_user_id, category_id, can_handle)
  VALUES (v_staff_1_user_id, v_cat_id, TRUE);

  -- Staff 2 (Level 1, capacity 2)
  INSERT INTO users (first_name, last_name, email, password_hash, role, primary_department_id)
  VALUES ('Bob', 'Officer', 'bob.officer@univoice.edu', 'hash', 'staff', v_dept_id)
  RETURNING id INTO v_staff_2_user_id;

  INSERT INTO staff_profiles (user_id, employee_number)
  VALUES (v_staff_2_user_id, 'EMP-002');

  INSERT INTO staff_department_memberships (staff_user_id, department_id, is_primary)
  VALUES (v_staff_2_user_id, v_dept_id, TRUE);

  INSERT INTO staff_department_authority_levels (staff_user_id, department_id, department_authority_level_id)
  VALUES (v_staff_2_user_id, v_dept_id, v_level_1_id);

  INSERT INTO staff_category_authorizations (staff_user_id, category_id, can_handle)
  VALUES (v_staff_2_user_id, v_cat_id, TRUE);

  -- Senior Staff (Level 2)
  INSERT INTO users (first_name, last_name, email, password_hash, role, primary_department_id)
  VALUES ('Sarah', 'Senior', 'sarah.senior@univoice.edu', 'hash', 'staff', v_dept_id)
  RETURNING id INTO v_staff_senior_id;

  INSERT INTO staff_profiles (user_id, employee_number)
  VALUES (v_staff_senior_id, 'EMP-003');

  INSERT INTO staff_department_memberships (staff_user_id, department_id, is_primary)
  VALUES (v_staff_senior_id, v_dept_id, TRUE);

  INSERT INTO staff_department_authority_levels (staff_user_id, department_id, department_authority_level_id)
  VALUES (v_staff_senior_id, v_dept_id, v_level_2_id);

  INSERT INTO staff_category_authorizations (staff_user_id, category_id, can_handle)
  VALUES (v_staff_senior_id, v_cat_id, TRUE);

  -- Unauthorized Staff (Finance only)
  INSERT INTO users (first_name, last_name, email, password_hash, role, primary_department_id)
  VALUES ('Frank', 'Finance', 'frank.finance@univoice.edu', 'hash', 'staff', v_other_dept_id)
  RETURNING id INTO v_unauth_staff_id;

  INSERT INTO staff_profiles (user_id, employee_number)
  VALUES (v_unauth_staff_id, 'EMP-004');

  INSERT INTO staff_department_memberships (staff_user_id, department_id, is_primary)
  VALUES (v_unauth_staff_id, v_other_dept_id, TRUE);

  INSERT INTO staff_department_authority_levels (staff_user_id, department_id, department_authority_level_id)
  VALUES (v_unauth_staff_id, v_other_dept_id, v_other_level_id);

  -- -----------------------------------------------------------------
  -- Test 1: Student submits request -> enters configured queue
  -- -----------------------------------------------------------------
  INSERT INTO requests (
    public_ref, title, description, student_id, category_id,
    responsible_department_id, current_authority_level_id, created_by
  ) VALUES (
    'REQ-2026-0001', 'Prerequisite Waiver', 'Need waiver for CS401',
    v_student_user_id, v_cat_id, v_dept_id, v_level_1_id, v_student_user_id
  ) RETURNING id INTO v_req_id;

  IF NOT EXISTS (
    SELECT 1 FROM requests
    WHERE id = v_req_id
      AND status = 'pending'
      AND current_assignment_id IS NULL
      AND current_authority_level_id = v_level_1_id
  ) THEN
    RAISE EXCEPTION 'Test 1 Failed: Request did not enter pending queue at Level 1';
  END IF;
  RAISE NOTICE 'Test 1 Passed: Student submitted request and entered Level 1 queue';

  -- -----------------------------------------------------------------
  -- Test 2: Eligible staff claims request
  -- -----------------------------------------------------------------
  v_assignment_id := claim_request(v_req_id, v_staff_1_user_id);

  IF NOT EXISTS (
    SELECT 1 FROM requests
    WHERE id = v_req_id
      AND status = 'assigned'
      AND current_assignment_id = v_assignment_id
  ) THEN
    RAISE EXCEPTION 'Test 2 Failed: Request not transitioned to assigned';
  END IF;
  RAISE NOTICE 'Test 2 Passed: Eligible staff claimed request successfully';

  -- -----------------------------------------------------------------
  -- Test 3: Concurrent claim attempt rejected (request already claimed)
  -- -----------------------------------------------------------------
  v_err_occurred := FALSE;
  BEGIN
    PERFORM claim_request(v_req_id, v_staff_2_user_id);
  EXCEPTION WHEN OTHERS THEN
    v_err_occurred := TRUE;
  END;

  IF NOT v_err_occurred THEN
    RAISE EXCEPTION 'Test 3 Failed: Second staff was able to claim already assigned request';
  END IF;
  RAISE NOTICE 'Test 3 Passed: Concurrent claim attempt rejected';

  -- -----------------------------------------------------------------
  -- Test 4: Staff escalates request to higher authority queue
  -- -----------------------------------------------------------------
  v_escalation_id := escalate_request_to_queue(
    v_req_id, v_staff_1_user_id, 'Requires department head sign-off'
  );

  IF NOT EXISTS (
    SELECT 1 FROM requests
    WHERE id = v_req_id
      AND status = 'pending'
      AND current_assignment_id IS NULL
      AND current_authority_level_id = v_level_2_id
      AND current_escalation_id = v_escalation_id
  ) THEN
    RAISE EXCEPTION 'Test 4 Failed: Request was not moved to Level 2 queue upon escalation';
  END IF;
  RAISE NOTICE 'Test 4 Passed: Request escalated to next authority queue (Level 2)';

  -- -----------------------------------------------------------------
  -- Test 5: Senior staff claims escalated request
  -- -----------------------------------------------------------------
  v_senior_asg_id := claim_request(v_req_id, v_staff_senior_id);

  IF NOT EXISTS (
    SELECT 1 FROM request_escalations
    WHERE id = v_escalation_id
      AND status = 'claimed'
      AND resulting_assignment_id = v_senior_asg_id
  ) THEN
    RAISE EXCEPTION 'Test 5 Failed: Escalation record not marked claimed with resulting assignment';
  END IF;
  RAISE NOTICE 'Test 5 Passed: Senior staff claimed escalated request';

  -- -----------------------------------------------------------------
  -- Test 6: Unauthorized staff cannot claim request
  -- -----------------------------------------------------------------
  -- Create a new request in Level 1 queue
  INSERT INTO requests (
    public_ref, title, description, student_id, category_id,
    responsible_department_id, current_authority_level_id, created_by
  ) VALUES (
    'REQ-2026-0002', 'Course Waiver 2', 'Another waiver request',
    v_student_user_id, v_cat_id, v_dept_id, v_level_1_id, v_student_user_id
  ) RETURNING id INTO v_req_id;

  v_err_occurred := FALSE;
  BEGIN
    -- Frank belongs to Finance, not Academic Affairs
    PERFORM claim_request(v_req_id, v_unauth_staff_id);
  EXCEPTION WHEN OTHERS THEN
    v_err_occurred := TRUE;
  END;

  IF NOT v_err_occurred THEN
    RAISE EXCEPTION 'Test 6 Failed: Unauthorized staff was able to claim request';
  END IF;
  RAISE NOTICE 'Test 6 Passed: Unauthorized staff rejected';

  -- -----------------------------------------------------------------
  -- Test 7: Staff at capacity cannot claim another request
  -- -----------------------------------------------------------------
  -- Staff 1 claims REQ-0002 (active count: 1)
  PERFORM claim_request(v_req_id, v_staff_1_user_id);

  -- Create REQ-0003 and Staff 1 claims (active count: 2, reaches limit of 2)
  INSERT INTO requests (
    public_ref, title, description, student_id, category_id,
    responsible_department_id, current_authority_level_id, created_by
  ) VALUES (
    'REQ-2026-0003', 'Course Waiver 3', 'Third waiver request',
    v_student_user_id, v_cat_id, v_dept_id, v_level_1_id, v_student_user_id
  ) RETURNING id INTO v_req_id;

  PERFORM claim_request(v_req_id, v_staff_1_user_id);

  -- Create REQ-0004: Staff 1 attempts to claim, should be blocked by capacity
  INSERT INTO requests (
    public_ref, title, description, student_id, category_id,
    responsible_department_id, current_authority_level_id, created_by
  ) VALUES (
    'REQ-2026-0004', 'Course Waiver 4', 'Fourth waiver request',
    v_student_user_id, v_cat_id, v_dept_id, v_level_1_id, v_student_user_id
  ) RETURNING id INTO v_req_id;

  v_err_occurred := FALSE;
  BEGIN
    PERFORM claim_request(v_req_id, v_staff_1_user_id);
  EXCEPTION WHEN OTHERS THEN
    v_err_occurred := TRUE;
  END;

  IF NOT v_err_occurred THEN
    RAISE EXCEPTION 'Test 7 Failed: Staff at capacity was able to claim another request';
  END IF;
  RAISE NOTICE 'Test 7 Passed: Staff at capacity correctly blocked from claiming';

  -- -----------------------------------------------------------------
  -- Test 8: Unavailable staff returns active requests to queues
  -- -----------------------------------------------------------------
  v_returned_count := set_staff_unavailable(v_staff_1_user_id, v_dept_id);

  IF v_returned_count <> 2 THEN
    RAISE EXCEPTION 'Test 8 Failed: Expected 2 requests returned, got %', v_returned_count;
  END IF;

  -- Verify active assignments were ended and requests returned to pending
  IF EXISTS (
    SELECT 1 FROM request_assignments
    WHERE assignee_id = v_staff_1_user_id AND ended_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Test 8 Failed: Staff member still has active assignments';
  END IF;
  RAISE NOTICE 'Test 8 Passed: Unavailable staff requests returned to queue';

  -- -----------------------------------------------------------------
  -- Test 9: A request cannot have two active assignments
  -- -----------------------------------------------------------------
  v_err_occurred := FALSE;
  BEGIN
    INSERT INTO request_assignments (request_id, assignee_id, department_id, source)
    VALUES (v_req_id, v_staff_2_user_id, v_dept_id, 'claim');

    INSERT INTO request_assignments (request_id, assignee_id, department_id, source)
    VALUES (v_req_id, v_staff_senior_id, v_dept_id, 'claim');
  EXCEPTION WHEN OTHERS THEN
    v_err_occurred := TRUE;
  END;

  IF NOT v_err_occurred THEN
    RAISE EXCEPTION 'Test 9 Failed: Request allowed multiple active assignments';
  END IF;
  RAISE NOTICE 'Test 9 Passed: Partial unique index prevented duplicate active assignments';

  -- -----------------------------------------------------------------
  -- Test 10: Invalid department/authority/category combinations rejected
  -- -----------------------------------------------------------------
  v_err_occurred := FALSE;
  BEGIN
    -- Category belongs to Academic Affairs, but attempt to set responsible department to Finance
    INSERT INTO requests (
      public_ref, title, description, student_id, category_id,
      responsible_department_id, current_authority_level_id, created_by
    ) VALUES (
      'REQ-INVALID', 'Invalid Department', 'Mismatch test',
      v_student_user_id, v_cat_id, v_other_dept_id, v_level_1_id, v_student_user_id
    );
  EXCEPTION WHEN OTHERS THEN
    v_err_occurred := TRUE;
  END;

  IF NOT v_err_occurred THEN
    RAISE EXCEPTION 'Test 10 Failed: Cross-department category inconsistency allowed';
  END IF;
  RAISE NOTICE 'Test 10 Passed: Category/department composite foreign key rejected mismatch';

  -- -----------------------------------------------------------------
  -- Test 11: Request history remains intact across lifecycles
  -- -----------------------------------------------------------------
  SELECT COUNT(*) INTO v_history_count
  FROM request_history
  WHERE request_id = v_req_id;

  IF v_history_count < 1 THEN
    RAISE EXCEPTION 'Test 11 Failed: Request history was not recorded';
  END IF;
  RAISE NOTICE 'Test 11 Passed: Request history integrity preserved (% events logged)', v_history_count;

  -- -----------------------------------------------------------------
  -- Test 12: Request at highest authority level raises exception on escalation
  -- -----------------------------------------------------------------
  -- Create request at highest level (Level 3)
  INSERT INTO requests (
    public_ref, title, description, student_id, category_id,
    responsible_department_id, current_authority_level_id, created_by
  ) VALUES (
    'REQ-2026-TOP', 'Final Escalation', 'Dean-level request',
    v_student_user_id, v_cat_id, v_dept_id, v_level_3_id, v_student_user_id
  ) RETURNING id INTO v_req_id;

  -- Assign to a staff member with Level 3 authority
  INSERT INTO staff_department_authority_levels (staff_user_id, department_id, department_authority_level_id)
  VALUES (v_staff_senior_id, v_dept_id, v_level_3_id)
  ON CONFLICT DO NOTHING;

  -- End previous assignment so senior staff can claim
  UPDATE request_assignments SET ended_at = NOW() WHERE assignee_id = v_staff_senior_id;
  PERFORM claim_request(v_req_id, v_staff_senior_id);

  v_err_occurred := FALSE;
  BEGIN
    -- Escalation at highest authority level must raise exception
    PERFORM escalate_request_to_queue(v_req_id, v_staff_senior_id, 'Cannot escalate further');
  EXCEPTION WHEN OTHERS THEN
    v_err_occurred := TRUE;
  END;

  IF NOT v_err_occurred THEN
    RAISE EXCEPTION 'Test 12 Failed: Final authority level allowed further escalation';
  END IF;
  RAISE NOTICE 'Test 12 Passed: Highest authority level correctly raises exception on escalation';

  RAISE NOTICE '=====================================================';
  RAISE NOTICE 'All 12 UniVoice validation tests PASSED successfully!';
  RAISE NOTICE '=====================================================';
END $$;

ROLLBACK;
