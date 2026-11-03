-- 11. In-app notifications
-- ---------------------------------------------------------------------------

CREATE TABLE notifications (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type            VARCHAR(50) NOT NULL,
  title           VARCHAR(255) NOT NULL,
  message         TEXT,
  request_id      UUID REFERENCES requests(id) ON DELETE RESTRICT,
  escalation_id   UUID REFERENCES request_escalations(id) ON DELETE RESTRICT,
  is_read         BOOLEAN NOT NULL DEFAULT FALSE,
  read_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT notifications_type_not_blank CHECK (btrim(type) <> ''),
  CONSTRAINT notifications_read_consistency
    CHECK (
      (is_read = FALSE AND read_at IS NULL)
      OR (is_read = TRUE AND read_at IS NOT NULL)
    )
);

COMMENT ON TABLE notifications IS
  'In-app user notifications. References requests/escalations without duplicating payload data.';
COMMENT ON COLUMN notifications.recipient_id IS
  'Recipient user. CASCADE on user deletion is appropriate as user inbox should not survive.';

-- ---------------------------------------------------------------------------
