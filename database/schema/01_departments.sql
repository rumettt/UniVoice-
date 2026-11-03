-- 1. Departments and department authority levels
-- ---------------------------------------------------------------------------

CREATE TABLE departments (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                        VARCHAR(100) NOT NULL,
  code                        VARCHAR(20)  NOT NULL,
  description                 TEXT,
  default_max_active_requests INTEGER NOT NULL DEFAULT 5,
  is_active                   BOOLEAN NOT NULL DEFAULT TRUE,
  deactivated_at              TIMESTAMPTZ,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT departments_name_unique UNIQUE (name),
  CONSTRAINT departments_code_unique UNIQUE (code),
  CONSTRAINT departments_code_format
    CHECK (code = upper(code) AND code ~ '^[A-Z0-9_]{2,20}$'),
  CONSTRAINT departments_default_max_active_positive
    CHECK (default_max_active_requests > 0),
  CONSTRAINT departments_deactivated_consistency
    CHECK (
      (is_active = TRUE AND deactivated_at IS NULL)
      OR (is_active = FALSE AND deactivated_at IS NOT NULL)
    )
);

COMMENT ON TABLE departments IS
  'University offices that own request categories, define authority queues, and receive unassigned work.';
COMMENT ON COLUMN departments.default_max_active_requests IS
  'Default maximum concurrent active requests per staff member in this department.';

-- Department-specific authority levels (e.g. Level 1 Officer, Level 2 Senior Officer, Level 3 Head)
CREATE TABLE department_authority_levels (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id  UUID NOT NULL REFERENCES departments(id) ON DELETE RESTRICT,
  code           VARCHAR(40)  NOT NULL,
  name           VARCHAR(100) NOT NULL,
  level_order    SMALLINT     NOT NULL,
  description    TEXT,
  is_active      BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT dept_authority_levels_dept_code_unique UNIQUE (department_id, code),
  CONSTRAINT dept_authority_levels_dept_name_unique UNIQUE (department_id, name),
  CONSTRAINT dept_authority_levels_dept_order_unique UNIQUE (department_id, level_order),
  CONSTRAINT dept_authority_levels_order_positive CHECK (level_order >= 1),
  CONSTRAINT dept_authority_levels_composite_unique UNIQUE (id, department_id)
);

COMMENT ON TABLE department_authority_levels IS
  'Department-specific authority hierarchy tiers. Higher level_order denotes higher handling/decision authority.';
COMMENT ON COLUMN department_authority_levels.level_order IS
  'Strict monotonic authority ranking within the department (1 = lowest/initial staff level).';
COMMENT ON CONSTRAINT dept_authority_levels_composite_unique ON department_authority_levels IS
  'Enables composite foreign keys validating that categories and requests reference levels in the matching department.';

-- ---------------------------------------------------------------------------
