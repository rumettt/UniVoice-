-- =============================================================================
-- UniVoice Request Management System
-- PostgreSQL schema (ordered, executable)
--
-- Database name: univoice_database
-- Create the database separately, then run this script against it:
--   CREATE DATABASE univoice_database;
--   \c univoice_database
--
-- This script is additive and does not DROP existing objects.
-- Do not run it against a populated production database without a backup
-- and the companion migration notes in migrate_from_existing.sql.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE SCHEMA IF NOT EXISTS reporting;

COMMENT ON SCHEMA reporting IS
  'Read-oriented reporting views. Operational tables remain in public.';

-- ---------------------------------------------------------------------------
