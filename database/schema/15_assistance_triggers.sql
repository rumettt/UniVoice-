DROP TRIGGER IF EXISTS trg_assistance_compatibilities_updated_at ON department_category_compatibilities;
CREATE TRIGGER trg_assistance_compatibilities_updated_at
  BEFORE UPDATE ON department_category_compatibilities
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_assistance_compatibility_identity_immutable ON department_category_compatibilities;
CREATE TRIGGER trg_assistance_compatibility_identity_immutable
  BEFORE UPDATE ON department_category_compatibilities
  FOR EACH ROW EXECUTE FUNCTION protect_assistance_compatibility_identity();

DROP TRIGGER IF EXISTS trg_assistance_tasks_updated_at ON request_assistance_tasks;
CREATE TRIGGER trg_assistance_tasks_updated_at
  BEFORE UPDATE ON request_assistance_tasks
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_assistance_transfers_updated_at ON request_assistance_department_transfers;
CREATE TRIGGER trg_assistance_transfers_updated_at
  BEFORE UPDATE ON request_assistance_department_transfers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_assistance_tasks_identity_immutable ON request_assistance_tasks;
CREATE TRIGGER trg_assistance_tasks_identity_immutable
  BEFORE UPDATE ON request_assistance_tasks
  FOR EACH ROW EXECUTE FUNCTION protect_assistance_task_identity();

DROP TRIGGER IF EXISTS trg_assistance_tasks_validate_route ON request_assistance_tasks;
CREATE TRIGGER trg_assistance_tasks_validate_route
  BEFORE INSERT OR UPDATE OF compatibility_id, supporting_department_id,
    supporting_category_id, supporting_authority_level_id
  ON request_assistance_tasks
  FOR EACH ROW EXECUTE FUNCTION validate_assistance_task_route();

DROP TRIGGER IF EXISTS trg_assistance_tasks_no_delete ON request_assistance_tasks;
CREATE TRIGGER trg_assistance_tasks_no_delete
  BEFORE DELETE ON request_assistance_tasks
  FOR EACH ROW EXECUTE FUNCTION prevent_mutation();

DROP TRIGGER IF EXISTS trg_assistance_assignments_protect_identity ON request_assistance_assignments;
CREATE TRIGGER trg_assistance_assignments_protect_identity
  BEFORE UPDATE ON request_assistance_assignments
  FOR EACH ROW EXECUTE FUNCTION protect_assistance_assignment_identity();

DROP TRIGGER IF EXISTS trg_assistance_assignments_no_delete ON request_assistance_assignments;
CREATE TRIGGER trg_assistance_assignments_no_delete
  BEFORE DELETE ON request_assistance_assignments
  FOR EACH ROW EXECUTE FUNCTION prevent_mutation();

DROP TRIGGER IF EXISTS trg_assistance_task_assignment_consistency ON request_assistance_tasks;
CREATE CONSTRAINT TRIGGER trg_assistance_task_assignment_consistency
  AFTER INSERT OR UPDATE ON request_assistance_tasks
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION enforce_assistance_task_assignment_consistency();

DROP TRIGGER IF EXISTS trg_assistance_assignment_task_consistency ON request_assistance_assignments;
CREATE CONSTRAINT TRIGGER trg_assistance_assignment_task_consistency
  AFTER INSERT OR UPDATE ON request_assistance_assignments
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION enforce_assistance_task_assignment_consistency();

DROP TRIGGER IF EXISTS trg_assistance_history_immutable ON request_assistance_history;
CREATE TRIGGER trg_assistance_history_immutable
  BEFORE UPDATE OR DELETE ON request_assistance_history
  FOR EACH ROW EXECUTE FUNCTION prevent_mutation();

DROP TRIGGER IF EXISTS trg_assistance_transfers_no_delete ON request_assistance_department_transfers;
CREATE TRIGGER trg_assistance_transfers_no_delete
  BEFORE DELETE ON request_assistance_department_transfers
  FOR EACH ROW EXECUTE FUNCTION prevent_mutation();

DROP TRIGGER IF EXISTS trg_assistance_reopen_requests_no_delete ON request_assistance_reopen_requests;
CREATE TRIGGER trg_assistance_reopen_requests_no_delete
  BEFORE DELETE ON request_assistance_reopen_requests
  FOR EACH ROW EXECUTE FUNCTION prevent_mutation();

DROP TRIGGER IF EXISTS trg_assistance_messages_immutable ON request_assistance_messages;
CREATE TRIGGER trg_assistance_messages_immutable
  BEFORE UPDATE OR DELETE ON request_assistance_messages
  FOR EACH ROW EXECUTE FUNCTION prevent_mutation();

DROP TRIGGER IF EXISTS trg_assistance_attachments_no_delete ON request_assistance_attachments;
CREATE TRIGGER trg_assistance_attachments_no_delete
  BEFORE UPDATE OR DELETE ON request_assistance_attachments
  FOR EACH ROW EXECUTE FUNCTION prevent_mutation();
