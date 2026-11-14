-- UniVoice PostgreSQL initial schema entry point (psql).
-- Creates the greenfield schema only; this does not apply future migrations.
-- Run from any directory with: psql -v ON_ERROR_STOP=1 -d univoice_database -f database/univoice_schema.sql

\ir schema/00_extensions_and_schemas.sql
\ir schema/01_departments.sql
\ir schema/02_users_and_authentication.sql
\ir schema/03_staff_positions_and_profiles.sql
\ir schema/04_staff_hierarchy.sql
\ir schema/05_categories_and_authorizations.sql
\ir schema/06_requests.sql
\ir schema/07_assignments.sql
\ir schema/08_escalations.sql
\ir schema/09_request_history.sql
\ir schema/10_comments_and_attachments.sql
\ir schema/11_notifications.sql
\ir schema/12_audit_logs.sql
\ir schema/13_cyclic_relationship_constraints.sql
\ir schema/14_functions.sql
\ir schema/15_triggers.sql
\ir schema/16_indexes.sql
\ir schema/17_reporting_views.sql
\ir schema/18_system_settings.sql
