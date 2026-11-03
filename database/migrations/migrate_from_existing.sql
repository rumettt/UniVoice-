-- =============================================================================
-- UniVoice — additive migration notes
--
-- Do not run this blindly against a populated database.
-- It is a planned sequence, not an automatic reset.
-- Existing Desktop RMS objects used names in public + reporting, DB name `rms`.
-- UniVoice uses database name univoice_database.
-- =============================================================================

-- 0. Take a backup / snapshot before any ALTER.
-- 1. Create univoice_database (or a Neon branch) and restore a copy first.

-- Example only:
-- CREATE DATABASE univoice_database;
-- -- restore dump here, then apply additive changes below.

-- ---------------------------------------------------------------------------
-- New tables (safe to create if they do not exist)
-- ---------------------------------------------------------------------------
-- refresh_tokens
-- student_profiles
-- staff_positions
-- staff_profiles
-- staff_department_memberships
-- staff_position_holdings
-- staff_supervisions
-- staff_category_authorizations
-- request_assignments
-- request_escalations
-- audit_logs

-- ---------------------------------------------------------------------------
-- Existing tables to ALTER (Desktop RMS / discussed objects)
-- ---------------------------------------------------------------------------
-- users:
--   * SQL migrations used full_name; User module used first_name, last_name,
--     phone, department_id, profile_image, last_login.
--   * Add missing columns, backfill names, then add NOT NULL / CHECKs.
--   * Rename department_id -> primary_department_id after backfill, or add
--     the new column, copy, then drop the old one in a later release.
--   * Do not drop password_hash. Do not copy it into audit_logs.

-- requests:
--   * assigned_to is replaced by current_assignment_id.
--   * department_id is renamed conceptually to responsible_department_id.
--   * Keep assigned_to readable during dual-write, then drop after backfill.
--   * Add public_ref, current_approver_id, current_escalation_id, due_at,
--     rejected_at, reopen_count, created_by, updated_by.

-- comments: add visibility; default existing rows to 'student_visible'.

-- attachments:
--   * Existing XOR (request_id OR comment_id) conflicts with always linking
--     files to a request. Backfill request_id from comments.request_id, then
--     set request_id NOT NULL and drop the XOR constraint.
--   * Rename storage_path -> storage_key if desired.

-- notifications:
--   * Rename user_id -> recipient_id.
--   * Change request_id ON DELETE CASCADE to RESTRICT.
--   * Add escalation_id.

-- request_history:
--   * Change ON DELETE CASCADE to RESTRICT.
--   * Add field_name + details; keep old_value/new_value.
--   * Stop using it for assignment/escalation detail.

-- reporting views: CREATE OR REPLACE after new columns exist.

-- ---------------------------------------------------------------------------
-- Required backfills
-- ---------------------------------------------------------------------------
-- 1. Split full_name into first_name/last_name where those columns are empty.
-- 2. Insert student_profiles for role = student (synthetic student_number
--    if none exists).
-- 3. Insert staff_profiles for role IN (staff, admin).
-- 4. For each request with assigned_to:
--      INSERT request_assignments (... source = 'initial', ended_at = NULL)
--      UPDATE requests SET current_assignment_id = <new id>,
--        status = CASE WHEN status = 'pending' THEN 'assigned' ELSE status END
--    in one transaction per request or a batched script.
-- 5. Set comments.visibility = 'student_visible' where NULL.
-- 6. Attachments: fill request_id from the parent comment when missing.

-- ---------------------------------------------------------------------------
-- Constraint additions (after backfill succeeds)
-- ---------------------------------------------------------------------------
-- users_role_allowed, users_staff_has_department
-- requests_status_allowed, requests_pending_is_unassigned,
-- requests_assigned_status_has_assignee
-- Unique open-escalation index
-- Exclusion constraints on effective-dated hierarchy tables

-- ---------------------------------------------------------------------------
-- Potentially destructive (do not run without explicit authorization)
-- ---------------------------------------------------------------------------
-- DROP COLUMN requests.assigned_to
-- DROP COLUMN users.full_name (only after generated full_name exists)
-- DROP CONSTRAINT attachments_must_belong_to_one
-- Changing notification FK from CASCADE to RESTRICT
-- RESET / DROP DATABASE
-- TRUNCATE of history tables
