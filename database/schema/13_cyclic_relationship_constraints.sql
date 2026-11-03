-- 13. Cyclic and cross-entity relationship constraints
-- Added after all operational tables (requests, assignments, escalations) exist.
-- ---------------------------------------------------------------------------

-- Guarantees requests.current_assignment_id belongs to this exact request
ALTER TABLE requests
  ADD CONSTRAINT requests_current_assignment_fk
    FOREIGN KEY (id, current_assignment_id)
    REFERENCES request_assignments(request_id, id)
    ON DELETE RESTRICT
    DEFERRABLE INITIALLY DEFERRED;

-- Guarantees requests.current_escalation_id belongs to this exact request
ALTER TABLE requests
  ADD CONSTRAINT requests_current_escalation_fk
    FOREIGN KEY (current_escalation_id, id)
    REFERENCES request_escalations(id, request_id)
    ON DELETE RESTRICT
    DEFERRABLE INITIALLY DEFERRED;

-- Assignment origin link to the escalation that produced it
ALTER TABLE request_assignments
  ADD CONSTRAINT request_assignments_source_escalation_fk
    FOREIGN KEY (source_escalation_id)
    REFERENCES request_escalations(id)
    ON DELETE RESTRICT
    DEFERRABLE INITIALLY DEFERRED;

-- Escalation from_assignment consistency
ALTER TABLE request_escalations
  ADD CONSTRAINT request_escalations_from_assignment_fk
    FOREIGN KEY (request_id, from_assignment_id)
    REFERENCES request_assignments(request_id, id)
    ON DELETE RESTRICT
    DEFERRABLE INITIALLY DEFERRED;

-- Escalation resulting_assignment consistency
ALTER TABLE request_escalations
  ADD CONSTRAINT request_escalations_resulting_assignment_fk
    FOREIGN KEY (request_id, resulting_assignment_id)
    REFERENCES request_assignments(request_id, id)
    ON DELETE RESTRICT
    DEFERRABLE INITIALLY DEFERRED;

-- ---------------------------------------------------------------------------
