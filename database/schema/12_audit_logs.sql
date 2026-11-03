-- 12. Security and system audit logs
-- ---------------------------------------------------------------------------

CREATE TABLE audit_logs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id      UUID REFERENCES users(id) ON DELETE SET NULL,
  action        VARCHAR(80) NOT NULL,
  resource_type VARCHAR(40) NOT NULL,
  resource_id   UUID,
  old_values    JSONB,
  new_values    JSONB,
  ip_address    INET,
  user_agent    VARCHAR(300),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT audit_logs_action_not_blank CHECK (btrim(action) <> '')
);

COMMENT ON TABLE audit_logs IS
  'Security, administrative, and configuration audit trail. Passwords, hashes, and session tokens must never be written here.';

-- ---------------------------------------------------------------------------
