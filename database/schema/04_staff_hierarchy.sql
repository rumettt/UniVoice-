-- 4. Staff hierarchy, memberships, positions, authority levels, and work settings
-- ---------------------------------------------------------------------------

CREATE TABLE staff_department_memberships (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_user_id UUID NOT NULL REFERENCES staff_profiles(user_id) ON DELETE RESTRICT,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE RESTRICT,
  is_primary    BOOLEAN NOT NULL DEFAULT FALSE,
  valid_from    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  valid_to      TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT staff_dept_memberships_range
    CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT staff_dept_memberships_no_overlap
    EXCLUDE USING gist (
      staff_user_id WITH =,
      department_id WITH =,
      tstzrange(valid_from, COALESCE(valid_to, 'infinity'::timestamptz), '[)') WITH &&
    )
);

COMMENT ON TABLE staff_department_memberships IS
  'Effective-dated department memberships. Staff may belong to multiple departments over time or concurrently.';

CREATE TABLE staff_position_holdings (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_user_id UUID NOT NULL REFERENCES staff_profiles(user_id) ON DELETE RESTRICT,
  position_id   UUID NOT NULL REFERENCES staff_positions(id) ON DELETE RESTRICT,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE RESTRICT,
  valid_from    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  valid_to      TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT staff_position_holdings_range
    CHECK (valid_to IS NULL OR valid_to > valid_from),
  -- Department-scoped: allows concurrent holdings in different departments, but not within the same department
  CONSTRAINT staff_position_holdings_no_overlap
    EXCLUDE USING gist (
      staff_user_id WITH =,
      department_id WITH =,
      tstzrange(valid_from, COALESCE(valid_to, 'infinity'::timestamptz), '[)') WITH &&
    )
);

COMMENT ON TABLE staff_position_holdings IS
  'Effective-dated organizational position holdings. Overlapping positions within the same department are rejected.';

CREATE TABLE staff_supervisions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supervisee_id  UUID NOT NULL REFERENCES staff_profiles(user_id) ON DELETE RESTRICT,
  supervisor_id  UUID NOT NULL REFERENCES staff_profiles(user_id) ON DELETE RESTRICT,
  valid_from     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  valid_to       TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT staff_supervisions_no_self
    CHECK (supervisee_id <> supervisor_id),
  CONSTRAINT staff_supervisions_range
    CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT staff_supervisions_no_overlap
    EXCLUDE USING gist (
      supervisee_id WITH =,
      tstzrange(valid_from, COALESCE(valid_to, 'infinity'::timestamptz), '[)') WITH &&
    )
);

COMMENT ON TABLE staff_supervisions IS
  'Line-management supervisory relationships for organizational reporting. Distinct from request-handling authority.';

-- Effective-dated mapping of staff to department authority levels
CREATE TABLE staff_department_authority_levels (
  id                            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_user_id                 UUID NOT NULL REFERENCES staff_profiles(user_id) ON DELETE RESTRICT,
  department_authority_level_id UUID NOT NULL REFERENCES department_authority_levels(id) ON DELETE RESTRICT,
  department_id                 UUID NOT NULL REFERENCES departments(id) ON DELETE RESTRICT,
  valid_from                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  valid_to                      TIMESTAMPTZ,
  created_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT staff_dept_auth_levels_range
    CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT staff_dept_auth_levels_dept_fk
    FOREIGN KEY (department_authority_level_id, department_id)
    REFERENCES department_authority_levels(id, department_id)
    ON DELETE RESTRICT,
  CONSTRAINT staff_dept_auth_levels_no_overlap
    EXCLUDE USING gist (
      staff_user_id WITH =,
      department_id WITH =,
      tstzrange(valid_from, COALESCE(valid_to, 'infinity'::timestamptz), '[)') WITH &&
    )
);

COMMENT ON TABLE staff_department_authority_levels IS
  'Effective-dated mapping of staff to their department authority levels. Enforces at most one active authority level per department.';

-- Staff availability and workload capacity settings per department
CREATE TABLE staff_department_work_settings (
  id                           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_user_id                UUID NOT NULL REFERENCES staff_profiles(user_id) ON DELETE RESTRICT,
  department_id                UUID NOT NULL REFERENCES departments(id) ON DELETE RESTRICT,
  is_available                 BOOLEAN NOT NULL DEFAULT TRUE,
  max_active_requests_override INTEGER,
  created_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT staff_dept_work_settings_unique UNIQUE (staff_user_id, department_id),
  CONSTRAINT staff_dept_work_settings_override_positive
    CHECK (max_active_requests_override IS NULL OR max_active_requests_override > 0)
);

COMMENT ON TABLE staff_department_work_settings IS
  'Operational workload and availability controls per staff member per department.';
COMMENT ON COLUMN staff_department_work_settings.is_available IS
  'When FALSE, staff cannot claim requests and active requests are automatically returned to the authority queue.';
COMMENT ON COLUMN staff_department_work_settings.max_active_requests_override IS
  'Staff-specific active request limit. When NULL, department default (departments.default_max_active_requests) applies.';

-- ---------------------------------------------------------------------------
