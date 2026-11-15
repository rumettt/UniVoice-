-- Assistance schema constraints validation. Requires a disposable database
-- built from univoice_schema.sql followed by V005 and V006.
\set ON_ERROR_STOP on
BEGIN;

DO $$
DECLARE
  pdept UUID; sdept UUID; xdept UUID;
  plvl UUID; slvl UUID; xlvl UUID;
  pcat UUID; scat UUID; xcat UUID;
  student UUID; handler UUID; supporter UUID; other_staff UUID;
  request_id UUID; request2_id UUID; parent_assignment UUID; task_id UUID; assignment_id UUID; request2_assignment UUID;
  compatibility_id UUID; xcompatibility_id UUID; message_id UUID; second_task UUID;
  transfer_id UUID; reopen_id UUID;
  suffix TEXT := upper(substr(md5(random()::text), 1, 8));
  failed BOOLEAN;
BEGIN
  INSERT INTO departments (name, code, default_max_active_requests)
  VALUES ('Assistance Parent ' || suffix, 'AP_' || suffix, 3) RETURNING id INTO pdept;
  INSERT INTO departments (name, code, default_max_active_requests)
  VALUES ('Assistance Support ' || suffix, 'AS_' || suffix, 3) RETURNING id INTO sdept;
  INSERT INTO departments (name, code, default_max_active_requests)
  VALUES ('Assistance Other ' || suffix, 'AO_' || suffix, 3) RETURNING id INTO xdept;
  INSERT INTO department_authority_levels (department_id, code, name, level_order)
  VALUES (pdept, 'P_' || suffix, 'Parent level ' || suffix, 1) RETURNING id INTO plvl;
  INSERT INTO department_authority_levels (department_id, code, name, level_order)
  VALUES (sdept, 'S_' || suffix, 'Support level ' || suffix, 1) RETURNING id INTO slvl;
  INSERT INTO department_authority_levels (department_id, code, name, level_order)
  VALUES (xdept, 'X_' || suffix, 'Other level ' || suffix, 1) RETURNING id INTO xlvl;
  INSERT INTO categories (name, department_id, initial_authority_level_id)
  VALUES ('Parent category ' || suffix, pdept, plvl) RETURNING id INTO pcat;
  INSERT INTO categories (name, department_id, initial_authority_level_id)
  VALUES ('Support category ' || suffix, sdept, slvl) RETURNING id INTO scat;
  INSERT INTO categories (name, department_id, initial_authority_level_id)
  VALUES ('Other category ' || suffix, xdept, xlvl) RETURNING id INTO xcat;

  INSERT INTO users (first_name, last_name, email, password_hash, role)
  VALUES ('Test', 'Student ' || suffix, 'as-student-' || suffix || '@example.edu', 'hash', 'student')
  RETURNING id INTO student;
  INSERT INTO student_profiles (user_id, student_number) VALUES (student, 'AS-' || suffix);
  INSERT INTO users (first_name, last_name, email, password_hash, role, primary_department_id)
  VALUES ('Parent', 'Handler ' || suffix, 'as-handler-' || suffix || '@example.edu', 'hash', 'staff', pdept)
  RETURNING id INTO handler;
  INSERT INTO staff_profiles (user_id, employee_number) VALUES (handler, 'AH-' || suffix);
  INSERT INTO users (first_name, last_name, email, password_hash, role, primary_department_id)
  VALUES ('Support', 'Handler ' || suffix, 'as-support-' || suffix || '@example.edu', 'hash', 'staff', sdept)
  RETURNING id INTO supporter;
  INSERT INTO staff_profiles (user_id, employee_number) VALUES (supporter, 'AS-' || suffix);
  INSERT INTO users (first_name, last_name, email, password_hash, role, primary_department_id)
  VALUES ('Other', 'Handler ' || suffix, 'as-other-' || suffix || '@example.edu', 'hash', 'staff', xdept)
  RETURNING id INTO other_staff;
  INSERT INTO staff_profiles (user_id, employee_number) VALUES (other_staff, 'AX-' || suffix);

  INSERT INTO requests (public_ref, title, description, student_id, category_id, initial_category_id,
      responsible_department_id, current_authority_level_id, created_by)
  VALUES ('AS-' || suffix, 'Parent request', 'Assistance schema fixture', student, pcat, pcat, pdept, plvl, student)
  RETURNING id INTO request_id;
  INSERT INTO request_assignments (request_id, assignee_id, assigned_by, department_id, source)
  VALUES (request_id, handler, handler, pdept, 'claim') RETURNING id INTO parent_assignment;
  UPDATE requests SET current_assignment_id = parent_assignment, status = 'assigned', updated_by = handler
  WHERE id = request_id;

  INSERT INTO department_category_compatibilities (origin_category_id, supporting_department_id, supporting_category_id)
  VALUES (pcat, sdept, scat) RETURNING id INTO compatibility_id;
  INSERT INTO department_category_compatibilities (origin_category_id, supporting_department_id, supporting_category_id)
  VALUES (pcat, xdept, xcat) RETURNING id INTO xcompatibility_id;

  INSERT INTO request_assistance_tasks (
    parent_request_id, created_by_handler_id, parent_assignment_id,
    parent_origin_department_id, parent_origin_category_id,
    original_compatibility_id, compatibility_id,
    original_supporting_department_id, original_supporting_category_id,
    original_supporting_authority_level_id, supporting_department_id,
    supporting_category_id, supporting_authority_level_id,
    title, description, reason
  ) VALUES (
    request_id, handler, parent_assignment, pdept, pcat,
    compatibility_id, compatibility_id, sdept, scat, slvl, sdept, scat, slvl,
    'Assistance task', 'Task description', 'Additional expertise required'
  ) RETURNING id INTO task_id;

  UPDATE department_category_compatibilities SET is_active = FALSE WHERE id = compatibility_id;
  IF NOT EXISTS (SELECT 1 FROM request_assistance_tasks WHERE id = task_id) THEN
    RAISE EXCEPTION 'Deactivating compatibility removed an existing task';
  END IF;
  UPDATE department_category_compatibilities SET is_active = TRUE WHERE id = compatibility_id;

  INSERT INTO request_assistance_assignments (task_id, staff_user_id, department_id)
  VALUES (task_id, supporter, sdept) RETURNING id INTO assignment_id;
  UPDATE request_assistance_tasks SET status = 'assigned', ever_claimed_at = NOW() WHERE id = task_id;

  INSERT INTO requests (public_ref, title, description, student_id, category_id, initial_category_id,
      responsible_department_id, current_authority_level_id, created_by)
  VALUES ('AS2-' || suffix, 'Capacity request', 'Shared capacity fixture', student, scat, scat, sdept, slvl, student)
  RETURNING id INTO request2_id;
  INSERT INTO request_assignments (request_id, assignee_id, assigned_by, department_id, source)
  VALUES (request2_id, supporter, supporter, sdept, 'claim') RETURNING id INTO request2_assignment;
  UPDATE requests SET current_assignment_id = request2_assignment, status = 'assigned', updated_by = supporter
  WHERE id = request2_id;
  INSERT INTO staff_department_work_settings (staff_user_id, department_id, max_active_requests_override)
  VALUES (supporter, sdept, 2);
  failed := FALSE;
  BEGIN
    PERFORM assert_staff_assignment_capacity(supporter, sdept);
  EXCEPTION WHEN check_violation OR restrict_violation THEN failed := TRUE;
  END;
  IF NOT failed THEN RAISE EXCEPTION 'Combined request and assistance capacity was not enforced'; END IF;

  failed := FALSE;
  BEGIN
    INSERT INTO request_assistance_assignments (task_id, staff_user_id, department_id)
    VALUES (task_id, other_staff, sdept);
  EXCEPTION WHEN unique_violation THEN failed := TRUE;
  END;
  IF NOT failed THEN RAISE EXCEPTION 'Active assignment uniqueness was not enforced'; END IF;

  failed := FALSE;
  BEGIN
    INSERT INTO request_assistance_tasks (
      parent_request_id, created_by_handler_id, parent_assignment_id,
      parent_origin_department_id, parent_origin_category_id, original_compatibility_id,
      compatibility_id, original_supporting_department_id, original_supporting_category_id,
      original_supporting_authority_level_id, supporting_department_id, supporting_category_id,
      supporting_authority_level_id, title, description, reason
    ) VALUES (request_id, handler, parent_assignment, pdept, pcat, compatibility_id,
      compatibility_id, sdept, xcat, slvl, sdept, xcat, slvl, 'Bad category', 'Description', 'Reason');
  EXCEPTION WHEN check_violation OR foreign_key_violation THEN failed := TRUE;
  END;
  IF NOT failed THEN RAISE EXCEPTION 'Mismatched supporting category/department was accepted'; END IF;

  failed := FALSE;
  BEGIN
    INSERT INTO request_assistance_tasks (
      parent_request_id, created_by_handler_id, parent_assignment_id,
      parent_origin_department_id, parent_origin_category_id, original_compatibility_id,
      compatibility_id, original_supporting_department_id, original_supporting_category_id,
      original_supporting_authority_level_id, supporting_department_id, supporting_category_id,
      supporting_authority_level_id, title, description, reason
    ) VALUES (request_id, handler, parent_assignment, pdept, pcat, compatibility_id,
      compatibility_id, sdept, scat, xlvl, sdept, scat, xlvl, 'Bad authority', 'Description', 'Reason');
  EXCEPTION WHEN check_violation OR foreign_key_violation THEN failed := TRUE;
  END;
  IF NOT failed THEN RAISE EXCEPTION 'Mismatched supporting authority/department was accepted'; END IF;

  failed := FALSE;
  BEGIN
    INSERT INTO request_assistance_tasks (
      parent_request_id, created_by_handler_id, parent_assignment_id,
      parent_origin_department_id, parent_origin_category_id, original_compatibility_id,
      compatibility_id, original_supporting_department_id, original_supporting_category_id,
      original_supporting_authority_level_id, supporting_department_id, supporting_category_id,
      supporting_authority_level_id, title, description, reason
    ) VALUES (request_id, supporter, request2_assignment, pdept, pcat, compatibility_id,
      compatibility_id, sdept, scat, slvl, sdept, scat, slvl, 'Bad parent assignment', 'Description', 'Reason');
  EXCEPTION WHEN foreign_key_violation THEN failed := TRUE;
  END;
  IF NOT failed THEN RAISE EXCEPTION 'Parent assignment from a different request was accepted'; END IF;

  failed := FALSE;
  BEGIN
    INSERT INTO request_assistance_tasks (
      parent_request_id, created_by_handler_id, parent_assignment_id,
      parent_origin_department_id, parent_origin_category_id, original_compatibility_id,
      compatibility_id, original_supporting_department_id, original_supporting_category_id,
      original_supporting_authority_level_id, supporting_department_id, supporting_category_id,
      supporting_authority_level_id, title, description, reason, status
    ) VALUES (request_id, handler, parent_assignment, pdept, pcat, compatibility_id,
      compatibility_id, sdept, scat, slvl, sdept, scat, slvl, 'Bad status', 'Description', 'Reason', 'bogus');
  EXCEPTION WHEN check_violation THEN failed := TRUE;
  END;
  IF NOT failed THEN RAISE EXCEPTION 'Invalid task status was accepted'; END IF;

  failed := FALSE;
  BEGIN
    INSERT INTO request_assistance_tasks (
      parent_request_id, created_by_handler_id, parent_assignment_id,
      parent_origin_department_id, parent_origin_category_id, original_compatibility_id,
      compatibility_id, original_supporting_department_id, original_supporting_category_id,
      original_supporting_authority_level_id, supporting_department_id, supporting_category_id,
      supporting_authority_level_id, title, description, reason
    ) VALUES (request_id, handler, parent_assignment, pdept, pcat, compatibility_id,
      compatibility_id, sdept, scat, slvl, sdept, scat, slvl, '  ', 'Description', 'Reason');
  EXCEPTION WHEN check_violation THEN failed := TRUE;
  END;
  IF NOT failed THEN RAISE EXCEPTION 'Blank required title was accepted'; END IF;

  failed := FALSE;
  BEGIN
    INSERT INTO request_assistance_tasks (
      parent_request_id, created_by_handler_id, parent_assignment_id,
      parent_origin_department_id, parent_origin_category_id, original_compatibility_id,
      compatibility_id, original_supporting_department_id, original_supporting_category_id,
      original_supporting_authority_level_id, supporting_department_id, supporting_category_id,
      supporting_authority_level_id, title, description, reason
    ) VALUES (request_id, handler, parent_assignment, pdept, pcat, compatibility_id,
      compatibility_id, sdept, scat, slvl, sdept, scat, slvl, 'Bad description', '  ', 'Reason');
  EXCEPTION WHEN check_violation THEN failed := TRUE;
  END;
  IF NOT failed THEN RAISE EXCEPTION 'Blank required description was accepted'; END IF;

  failed := FALSE;
  BEGIN
    INSERT INTO request_assistance_tasks (
      parent_request_id, created_by_handler_id, parent_assignment_id,
      parent_origin_department_id, parent_origin_category_id, original_compatibility_id,
      compatibility_id, original_supporting_department_id, original_supporting_category_id,
      original_supporting_authority_level_id, supporting_department_id, supporting_category_id,
      supporting_authority_level_id, title, description, reason
    ) VALUES (request_id, handler, parent_assignment, pdept, pcat, compatibility_id,
      compatibility_id, sdept, scat, slvl, sdept, scat, slvl, 'Bad reason', 'Description', '  ');
  EXCEPTION WHEN check_violation THEN failed := TRUE;
  END;
  IF NOT failed THEN RAISE EXCEPTION 'Blank required reason was accepted'; END IF;

  failed := FALSE;
  BEGIN
    UPDATE request_assistance_tasks SET correction_count = -1 WHERE id = task_id;
  EXCEPTION WHEN check_violation THEN failed := TRUE;
  END;
  IF NOT failed THEN RAISE EXCEPTION 'Negative correction count was accepted'; END IF;

  failed := FALSE;
  BEGIN
    UPDATE request_assistance_tasks SET deleted_at = NOW() WHERE id = task_id;
  EXCEPTION WHEN check_violation OR restrict_violation THEN failed := TRUE;
  END;
  IF NOT failed THEN RAISE EXCEPTION 'Claimed task was soft-deleted'; END IF;

  INSERT INTO request_assistance_tasks (
    parent_request_id, created_by_handler_id, parent_assignment_id,
    parent_origin_department_id, parent_origin_category_id, original_compatibility_id,
    compatibility_id, original_supporting_department_id, original_supporting_category_id,
    original_supporting_authority_level_id, supporting_department_id, supporting_category_id,
    supporting_authority_level_id, title, description, reason
  ) VALUES (request_id, handler, parent_assignment, pdept, pcat, compatibility_id,
    compatibility_id, sdept, scat, slvl, sdept, scat, slvl, 'Deletable', 'Description', 'Reason')
  RETURNING id INTO second_task;
  UPDATE request_assistance_tasks SET deleted_at = NOW() WHERE id = second_task;

  INSERT INTO request_assistance_department_transfers (
    task_id, initiated_by, previous_status, parent_origin_category_id, previous_compatibility_id,
    previous_department_id, previous_category_id, previous_authority_level_id,
    target_department_id, target_category_id, target_authority_level_id,
    target_compatibility_id, reason, status, previous_assignment_id, previous_handler_id
  ) VALUES (task_id, handler, 'assigned', pcat, compatibility_id,
    sdept, scat, slvl, xdept, xcat, xlvl, xcompatibility_id,
    'Route change', 'pending', assignment_id, supporter)
  RETURNING id INTO transfer_id;
  failed := FALSE;
  BEGIN
    INSERT INTO request_assistance_department_transfers (
      task_id, initiated_by, previous_status, parent_origin_category_id, previous_compatibility_id,
      previous_department_id, previous_category_id, previous_authority_level_id,
      target_department_id, target_category_id, target_authority_level_id,
      target_compatibility_id, reason, status, previous_assignment_id, previous_handler_id
    ) VALUES (task_id, handler, 'assigned', pcat, compatibility_id,
      sdept, scat, slvl, xdept, xcat, xlvl, xcompatibility_id,
      'Duplicate route change', 'pending', assignment_id, supporter);
  EXCEPTION WHEN unique_violation THEN failed := TRUE;
  END;
  IF NOT failed THEN RAISE EXCEPTION 'Duplicate pending transfer was accepted'; END IF;

  UPDATE request_assistance_department_transfers
  SET status = 'cancelled', decided_at = NOW(), cancelled_at = NOW(),
      cancellation_reason = 'Schema validation cleanup'
  WHERE id = transfer_id;
  UPDATE request_assistance_assignments SET ended_at = NOW() WHERE id = assignment_id;
  UPDATE request_assistance_tasks SET status = 'closed', closed_at = NOW() WHERE id = task_id;

  INSERT INTO request_assistance_reopen_requests (task_id, requested_by, explanation)
  VALUES (task_id, supporter, 'Please reopen for follow-up') RETURNING id INTO reopen_id;
  failed := FALSE;
  BEGIN
    INSERT INTO request_assistance_reopen_requests (task_id, requested_by, explanation)
    VALUES (task_id, other_staff, 'Duplicate reopen');
  EXCEPTION WHEN unique_violation THEN failed := TRUE;
  END;
  IF NOT failed THEN RAISE EXCEPTION 'Duplicate pending reopening request was accepted'; END IF;

  INSERT INTO request_assistance_messages (task_id, author_id, assignment_id, content)
  VALUES (task_id, supporter, assignment_id, 'Task message') RETURNING id INTO message_id;
  failed := FALSE;
  BEGIN
    INSERT INTO request_assistance_messages (task_id, author_id, assignment_id, content)
    VALUES (task_id, other_staff, assignment_id, 'Wrong assignment owner');
  EXCEPTION WHEN foreign_key_violation THEN failed := TRUE;
  END;
  IF NOT failed THEN RAISE EXCEPTION 'Message assignment/task/author mismatch was accepted'; END IF;

  INSERT INTO request_assistance_attachments (task_id, message_id, uploaded_by, original_name, storage_key)
  VALUES (task_id, message_id, supporter, 'file.txt', 'assistance/test-file');
  failed := FALSE;
  BEGIN
    INSERT INTO request_assistance_attachments (task_id, message_id, uploaded_by, original_name, storage_key)
    VALUES (second_task, message_id, supporter, 'wrong-task.txt', 'assistance/wrong-task');
  EXCEPTION WHEN foreign_key_violation THEN failed := TRUE;
  END;
  IF NOT failed THEN RAISE EXCEPTION 'Attachment/message/task mismatch was accepted'; END IF;

  INSERT INTO request_assistance_history (task_id, parent_request_id, actor_id, action)
  VALUES (task_id, request_id, handler, 'schema_test');
  failed := FALSE;
  BEGIN
    UPDATE request_assistance_history h SET action = 'mutated' WHERE h.task_id = task_id;
  EXCEPTION WHEN restrict_violation THEN failed := TRUE;
  END;
  IF NOT failed THEN RAISE EXCEPTION 'Assistance history was mutable'; END IF;

  failed := FALSE;
  BEGIN
    DELETE FROM request_assistance_tasks WHERE id = second_task;
  EXCEPTION WHEN restrict_violation THEN failed := TRUE;
  END;
  IF NOT failed THEN RAISE EXCEPTION 'Task physical deletion was allowed'; END IF;

  failed := FALSE;
  BEGIN
    DELETE FROM request_assistance_assignments WHERE id = assignment_id;
  EXCEPTION WHEN restrict_violation THEN failed := TRUE;
  END;
  IF NOT failed THEN RAISE EXCEPTION 'Assignment history deletion was allowed'; END IF;

  RAISE NOTICE 'Assistance schema constraint validation passed';
END;
$$;

ROLLBACK;
