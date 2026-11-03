-- 9. Request lifecycle history
-- ---------------------------------------------------------------------------

CREATE TABLE request_history (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id  UUID NOT NULL REFERENCES requests(id) ON DELETE RESTRICT,
  actor_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  action      VARCHAR(50) NOT NULL,
  field_name  VARCHAR(64),
  old_value   TEXT,
  new_value   TEXT,
  details     JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT request_history_action_not_blank CHECK (btrim(action) <> '')
);

COMMENT ON TABLE request_history IS
  'Append-only business audit trail recording request lifecycle changes (status, priority, department, authority level, claims, escalations).';
COMMENT ON COLUMN request_history.details IS
  'Optional structured JSON metadata. Never store passwords, tokens, or personal credentials.';

-- ---------------------------------------------------------------------------
