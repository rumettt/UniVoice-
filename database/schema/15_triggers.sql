-- 15. Trigger bindings. All functions and target tables are defined first.
-- ---------------------------------------------------------------------------

CREATE TRIGGER trg_departments_updated_at
  BEFORE UPDATE ON departments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_dept_authority_levels_updated_at
  BEFORE UPDATE ON department_authority_levels
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_student_profiles_updated_at
  BEFORE UPDATE ON student_profiles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_staff_positions_updated_at
  BEFORE UPDATE ON staff_positions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_staff_profiles_updated_at
  BEFORE UPDATE ON staff_profiles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_staff_supervisions_no_cycle
  BEFORE INSERT OR UPDATE ON staff_supervisions
  FOR EACH ROW EXECUTE FUNCTION prevent_supervision_cycle();

CREATE TRIGGER trg_staff_supervisions_protect_identity
  BEFORE UPDATE ON staff_supervisions
  FOR EACH ROW EXECUTE FUNCTION protect_supervision_identity();

CREATE TRIGGER trg_staff_dept_work_settings_updated_at
  BEFORE UPDATE ON staff_department_work_settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_categories_updated_at
  BEFORE UPDATE ON categories
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_requests_updated_at
  BEFORE UPDATE ON requests
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_requests_lifecycle_history
  AFTER INSERT OR UPDATE OF status, priority, responsible_department_id, current_authority_level_id
  ON requests
  FOR EACH ROW EXECUTE FUNCTION record_request_lifecycle_change();

CREATE TRIGGER trg_request_history_immutable
  BEFORE UPDATE OR DELETE ON request_history
  FOR EACH ROW EXECUTE FUNCTION prevent_mutation();

CREATE TRIGGER trg_request_assignments_immutable
  BEFORE DELETE ON request_assignments
  FOR EACH ROW EXECUTE FUNCTION prevent_mutation();

CREATE TRIGGER trg_request_assignments_protect_identity
  BEFORE UPDATE ON request_assignments
  FOR EACH ROW EXECUTE FUNCTION protect_assignment_identity();

CREATE TRIGGER trg_request_escalations_immutable
  BEFORE DELETE ON request_escalations
  FOR EACH ROW EXECUTE FUNCTION prevent_mutation();

CREATE TRIGGER trg_request_escalations_protect_identity
  BEFORE UPDATE ON request_escalations
  FOR EACH ROW EXECUTE FUNCTION protect_escalation_identity();

CREATE TRIGGER trg_comments_updated_at
  BEFORE UPDATE ON comments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_audit_logs_immutable
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION prevent_mutation();

-- ---------------------------------------------------------------------------
