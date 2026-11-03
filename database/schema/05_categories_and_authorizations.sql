-- 5. Categories and authorizations (distinct from hierarchy)
-- ---------------------------------------------------------------------------

CREATE TABLE categories (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                       VARCHAR(100) NOT NULL,
  description                TEXT,
  department_id              UUID NOT NULL REFERENCES departments(id) ON DELETE RESTRICT,
  initial_authority_level_id UUID NOT NULL,
  default_priority           VARCHAR(20)  NOT NULL DEFAULT 'medium',
  default_due_hours          INTEGER,
  is_active                  BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at                 TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at                 TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT categories_name_department_unique UNIQUE (name, department_id),
  CONSTRAINT categories_composite_dept_unique UNIQUE (id, department_id),
  CONSTRAINT categories_authority_level_dept_fk
    FOREIGN KEY (initial_authority_level_id, department_id)
    REFERENCES department_authority_levels(id, department_id)
    ON DELETE RESTRICT,
  CONSTRAINT categories_default_priority_allowed
    CHECK (default_priority IN ('low', 'medium', 'high', 'urgent')),
  CONSTRAINT categories_due_hours_positive
    CHECK (default_due_hours IS NULL OR default_due_hours > 0)
);

COMMENT ON TABLE categories IS
  'Student-facing request categories. Defines the responsible department and initial authority queue.';
COMMENT ON COLUMN categories.initial_authority_level_id IS
  'Authority queue entered when a request is submitted. Foreign key strictly verified against the department.';

CREATE TABLE staff_category_authorizations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_user_id UUID NOT NULL REFERENCES staff_profiles(user_id) ON DELETE RESTRICT,
  category_id   UUID NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  can_handle    BOOLEAN NOT NULL DEFAULT TRUE,
  can_decide    BOOLEAN NOT NULL DEFAULT FALSE,
  valid_from    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  valid_to      TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT staff_category_auth_range
    CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT staff_category_auth_capability
    CHECK (can_handle OR can_decide),
  CONSTRAINT staff_category_auth_no_overlap
    EXCLUDE USING gist (
      staff_user_id WITH =,
      category_id WITH =,
      tstzrange(valid_from, COALESCE(valid_to, 'infinity'::timestamptz), '[)') WITH &&
    )
);

COMMENT ON TABLE staff_category_authorizations IS
  'Explicit permissions defining who may handle or decide requests under a category. Independent of titles or positions.';

-- ---------------------------------------------------------------------------
