-- 10. Comments and attachment metadata
-- ---------------------------------------------------------------------------

CREATE TABLE comments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id  UUID NOT NULL REFERENCES requests(id) ON DELETE RESTRICT,
  author_id   UUID REFERENCES users(id) ON DELETE SET NULL,
  content     TEXT NOT NULL,
  visibility  VARCHAR(20) NOT NULL DEFAULT 'student_visible',
  deleted_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT comments_content_not_blank CHECK (btrim(content) <> ''),
  CONSTRAINT comments_visibility_allowed
    CHECK (visibility IN ('student_visible', 'internal')),
  CONSTRAINT comments_composite_req_id UNIQUE (id, request_id)
);

COMMENT ON TABLE comments IS
  'Discussion timeline on requests. student_visible is readable by student; internal is staff/admin only.';

CREATE TABLE attachments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id      UUID NOT NULL REFERENCES requests(id) ON DELETE RESTRICT,
  comment_id      UUID,
  uploaded_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  original_name   VARCHAR(255) NOT NULL,
  storage_backend VARCHAR(40)  NOT NULL DEFAULT 'local',
  storage_key     VARCHAR(500) NOT NULL,
  mime_type       VARCHAR(100),
  file_size_bytes BIGINT,
  checksum_sha256 CHAR(64),
  deleted_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT attachments_file_size_nonnegative
    CHECK (file_size_bytes IS NULL OR file_size_bytes >= 0),
  CONSTRAINT attachments_storage_backend_allowed
    CHECK (storage_backend IN ('local', 's3', 'gcs', 'azure')),
  CONSTRAINT attachments_sha256_format
    CHECK (checksum_sha256 IS NULL OR checksum_sha256 ~ '^[0-9a-f]{64}$'),

  -- Enforces that an attachment linked to a comment belongs to the exact same request
  CONSTRAINT attachments_comment_req_fk
    FOREIGN KEY (comment_id, request_id)
    REFERENCES comments(id, request_id)
    ON DELETE RESTRICT
);

COMMENT ON TABLE attachments IS
  'File metadata only. Actual binary files remain in object or disk storage.';

-- ---------------------------------------------------------------------------
