-- 2. Users and authentication
-- ---------------------------------------------------------------------------

CREATE TABLE users (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name              VARCHAR(50)  NOT NULL,
  last_name               VARCHAR(50)  NOT NULL,
  full_name               VARCHAR(101) GENERATED ALWAYS AS
                            (btrim(first_name || ' ' || last_name)) STORED,
  email                   VARCHAR(255) NOT NULL,
  phone                   VARCHAR(20),
  password_hash           VARCHAR(255) NOT NULL,
  role                    VARCHAR(20)  NOT NULL,
  primary_department_id   UUID REFERENCES departments(id) ON DELETE RESTRICT,
  profile_image_url       VARCHAR(500),
  is_active               BOOLEAN NOT NULL DEFAULT TRUE,
  deactivated_at          TIMESTAMPTZ,
  last_login_at           TIMESTAMPTZ,
  password_changed_at     TIMESTAMPTZ,
  password_reset_token_hash VARCHAR(255),
  password_reset_expires_at TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT users_email_unique UNIQUE (email),
  CONSTRAINT users_email_format
    CHECK (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'),
  CONSTRAINT users_role_allowed
    CHECK (role IN ('student', 'staff', 'admin')),
  CONSTRAINT users_phone_format
    CHECK (phone IS NULL OR phone ~ '^[+0-9 ().-]{8,20}$'),
  CONSTRAINT users_student_has_no_department
    CHECK (role <> 'student' OR primary_department_id IS NULL),
  CONSTRAINT users_staff_has_department
    CHECK (role <> 'staff' OR primary_department_id IS NOT NULL),
  CONSTRAINT users_deactivated_consistency
    CHECK (
      (is_active = TRUE AND deactivated_at IS NULL)
      OR (is_active = FALSE AND deactivated_at IS NOT NULL)
    )
);

COMMENT ON TABLE users IS
  'Account identities for students, staff, and administrators. Passwords are stored only as hashes.';
COMMENT ON COLUMN users.password_hash IS
  'bcrypt/argon2 hash only. Never write plaintext or hashes into audit logs.';
COMMENT ON COLUMN users.primary_department_id IS
  'Current home department for staff/admin. Historical memberships live in staff_department_memberships.';
COMMENT ON COLUMN users.role IS
  'Coarse account type. It is not authorization to handle a category or approve a request.';

CREATE TABLE refresh_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  VARCHAR(255) NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  revoked_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT refresh_tokens_token_hash_unique UNIQUE (token_hash),
  CONSTRAINT refresh_tokens_expiry_after_create
    CHECK (expires_at > created_at)
);

COMMENT ON TABLE refresh_tokens IS
  'Session refresh tokens. Store a hash of the token, not the token itself. Safe to delete on logout.';

CREATE TABLE student_profiles (
  user_id         UUID PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
  student_number  VARCHAR(40) NOT NULL,
  program_name    VARCHAR(120),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT student_profiles_student_number_unique UNIQUE (student_number)
);

COMMENT ON TABLE student_profiles IS
  'Student-specific attributes. A row must exist before the user can submit requests.';

-- ---------------------------------------------------------------------------
