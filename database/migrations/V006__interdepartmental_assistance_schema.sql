-- ============================================================================
-- V006: Interdepartmental assistance schema and shared request capacity check
-- Requires the V005 permanent-transfer migration. Do not edit or replay V005
-- as a substitute for this forward migration.
-- Run with psql from any directory; included modules are resolved relative to
-- this migration file.
-- ============================================================================

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.request_transfers') IS NULL THEN
    RAISE EXCEPTION 'V006 requires V005: public.request_transfers is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'requests'
      AND column_name = 'initial_category_id'
  ) THEN
    RAISE EXCEPTION 'V006 requires V005: requests.initial_category_id is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_requests_protect_initial_category'
      AND tgrelid = 'public.requests'::regclass AND NOT tgisinternal
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_requests_invalidate_pending_transfer'
      AND tgrelid = 'public.requests'::regclass AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'V006 requires a complete V005: expected request transfer triggers are missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.request_assignments'::regclass
      AND conname = 'request_assignments_source_allowed'
      AND pg_get_constraintdef(oid) LIKE '%transfer%'
  ) THEN
    RAISE EXCEPTION 'V006 requires V005: request assignment transfer source is missing';
  END IF;
END;
$$;

\ir ../schema/07_assistance.sql
\ir ../schema/11_assistance_notifications.sql
\ir ../schema/14_assistance_functions.sql
\ir ../schema/15_assistance_triggers.sql
\ir ../schema/16_assistance_indexes.sql

COMMIT;
