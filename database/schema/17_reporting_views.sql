-- 17. Reporting and analytical views
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW reporting.request_summary AS
SELECT
  r.id AS request_id,
  r.public_ref,
  r.title,
  student.full_name AS student_name,
  student.email AS student_email,
  c.name AS category_name,
  d.name AS department_name,
  al.name AS current_authority_level_name,
  al.level_order AS current_authority_level_order,
  assignee.full_name AS assigned_staff,
  assignee.email AS assigned_staff_email,
  r.priority,
  r.status,
  r.due_at,
  (r.due_at IS NOT NULL
    AND r.due_at < NOW()
    AND r.status IN ('pending', 'assigned', 'in_progress')) AS is_overdue,
  r.created_at,
  r.resolved_at,
  r.closed_at,
  r.reopen_count,
  CASE
    WHEN r.status = 'pending'
    THEN ROUND((EXTRACT(EPOCH FROM (NOW() - r.created_at)) / 3600.0)::numeric, 2)
    ELSE NULL
  END AS hours_waiting_in_queue,
  CASE
    WHEN r.resolved_at IS NOT NULL
    THEN ROUND((EXTRACT(EPOCH FROM (r.resolved_at - r.created_at)) / 3600.0)::numeric, 2)
    ELSE NULL
  END AS resolution_hours,
  CASE
    WHEN r.closed_at IS NOT NULL
    THEN ROUND((EXTRACT(EPOCH FROM (r.closed_at - r.created_at)) / 3600.0)::numeric, 2)
    ELSE NULL
  END AS lifecycle_hours
FROM requests r
JOIN users student ON student.id = r.student_id
JOIN categories c ON c.id = r.category_id
JOIN departments d ON d.id = r.responsible_department_id
JOIN department_authority_levels al ON al.id = r.current_authority_level_id
LEFT JOIN request_assignments ra ON ra.id = r.current_assignment_id
LEFT JOIN users assignee ON assignee.id = ra.assignee_id
WHERE r.deleted_at IS NULL;

COMMENT ON VIEW reporting.request_summary IS
  'Operational snapshot of requests including current department authority queue and assignee.';

CREATE OR REPLACE VIEW reporting.department_performance AS
SELECT
  d.id AS department_id,
  d.name AS department_name,
  COUNT(r.id) AS total_requests,
  COUNT(r.id) FILTER (WHERE r.status = 'pending') AS pending_count,
  COUNT(r.id) FILTER (WHERE r.status = 'assigned') AS assigned_count,
  COUNT(r.id) FILTER (WHERE r.status = 'in_progress') AS in_progress_count,
  COUNT(r.id) FILTER (WHERE r.status = 'resolved') AS resolved_count,
  COUNT(r.id) FILTER (WHERE r.status = 'closed') AS closed_count,
  COUNT(r.id) FILTER (WHERE r.status = 'rejected') AS rejected_count,
  COUNT(r.id) FILTER (
    WHERE r.due_at IS NOT NULL
      AND r.due_at < NOW()
      AND r.status IN ('pending', 'assigned', 'in_progress')
  ) AS overdue_count,
  ROUND(
    AVG(EXTRACT(EPOCH FROM (r.resolved_at - r.created_at)) / 3600.0)
      FILTER (WHERE r.resolved_at IS NOT NULL)::numeric,
    2
  ) AS avg_resolution_hours
FROM departments d
LEFT JOIN requests r
  ON r.responsible_department_id = d.id
 AND r.deleted_at IS NULL
GROUP BY d.id, d.name;

COMMENT ON VIEW reporting.department_performance IS
  'Department-level operational throughput and resolution performance.';

CREATE OR REPLACE VIEW reporting.escalation_summary AS
SELECT
  e.id AS escalation_id,
  e.request_id,
  r.public_ref,
  d.name AS department_name,
  e.sequence_no,
  initiator.full_name AS initiated_by_name,
  from_al.name AS from_authority_level,
  from_al.level_order AS from_authority_level_order,
  to_al.name AS to_authority_level,
  to_al.level_order AS to_authority_level_order,
  e.reason,
  e.status AS escalation_status,
  e.created_at AS escalated_at,
  e.claimed_at,
  claiming_staff.full_name AS claimed_by_name,
  ROUND(
    (EXTRACT(EPOCH FROM (COALESCE(e.claimed_at, NOW()) - e.created_at)) / 3600.0)::numeric,
    2
  ) AS hours_to_claim_or_elapsed
FROM request_escalations e
JOIN requests r ON r.id = e.request_id
JOIN departments d ON d.id = r.responsible_department_id
JOIN department_authority_levels from_al ON from_al.id = e.from_authority_level_id
JOIN department_authority_levels to_al ON to_al.id = e.to_authority_level_id
JOIN users initiator ON initiator.id = e.initiated_by
LEFT JOIN request_assignments res_asg ON res_asg.id = e.resulting_assignment_id
LEFT JOIN users claiming_staff ON claiming_staff.id = res_asg.assignee_id;

COMMENT ON VIEW reporting.escalation_summary IS
  'Queue-based escalation tracking showing transitions between authority tiers and time to claim.';

CREATE OR REPLACE VIEW reporting.staff_workload AS
SELECT
  u.id AS staff_user_id,
  u.full_name,
  d.id AS department_id,
  d.name AS department_name,
  dal.name AS current_authority_level,
  dal.level_order AS current_authority_level_order,
  COALESCE(ws.is_available, TRUE) AS is_available,
  COALESCE(ws.max_active_requests_override, d.default_max_active_requests, 5) AS effective_capacity_limit,
  COUNT(ra.id) FILTER (WHERE ra.ended_at IS NULL) AS active_assigned_count,
  (COALESCE(ws.max_active_requests_override, d.default_max_active_requests, 5) -
    COUNT(ra.id) FILTER (WHERE ra.ended_at IS NULL)) AS remaining_capacity
FROM staff_profiles sp
JOIN users u ON u.id = sp.user_id
JOIN staff_department_memberships sdm
  ON sdm.staff_user_id = sp.user_id
 AND (sdm.valid_to IS NULL OR sdm.valid_to > NOW())
JOIN departments d ON d.id = sdm.department_id
LEFT JOIN staff_department_authority_levels sdal
  ON sdal.staff_user_id = sp.user_id
 AND sdal.department_id = d.id
 AND (sdal.valid_to IS NULL OR sdal.valid_to > NOW())
LEFT JOIN department_authority_levels dal
  ON dal.id = sdal.department_authority_level_id
LEFT JOIN staff_department_work_settings ws
  ON ws.staff_user_id = sp.user_id
 AND ws.department_id = d.id
LEFT JOIN request_assignments ra
  ON ra.assignee_id = sp.user_id
 AND ra.department_id = d.id
 AND ra.ended_at IS NULL
GROUP BY
  u.id, u.full_name, d.id, d.name, dal.name, dal.level_order,
  ws.is_available, ws.max_active_requests_override, d.default_max_active_requests;

COMMENT ON VIEW reporting.staff_workload IS
  'Real-time staff capacity and active workload per department.';

-- ---------------------------------------------------------------------------
