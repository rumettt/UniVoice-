-- 3. Staff positions, membership, and hierarchy
-- ---------------------------------------------------------------------------

CREATE TABLE staff_positions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code        VARCHAR(40)  NOT NULL,
  name        VARCHAR(100) NOT NULL,
  rank_level  SMALLINT     NOT NULL,
  description TEXT,
  is_active   BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT staff_positions_code_unique UNIQUE (code),
  CONSTRAINT staff_positions_name_unique UNIQUE (name),
  CONSTRAINT staff_positions_rank_positive CHECK (rank_level >= 1)
);

COMMENT ON TABLE staff_positions IS
  'Configurable organizational titles. rank_level orders seniority; it does not grant category permissions.';

CREATE TABLE staff_profiles (
  user_id             UUID PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
  employee_number     VARCHAR(40) NOT NULL,
  current_position_id UUID REFERENCES staff_positions(id) ON DELETE RESTRICT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT staff_profiles_employee_number_unique UNIQUE (employee_number)
);

COMMENT ON TABLE staff_profiles IS
  'Staff who may be assigned requests, supervise others, or receive escalations. Admins who handle work also need a row.';
COMMENT ON COLUMN staff_profiles.current_position_id IS
  'Convenience pointer to the live position. Effective-dated holdings are the historical record.';
