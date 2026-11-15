# UniVoice PostgreSQL Schema & Architecture

## Initial Schema Creation

The initial greenfield schema is split into ordered, modular SQL files under `schema/`.
[`univoice_schema.sql`](./univoice_schema.sql) is the `psql` entry point; it includes those files in their required dependency order.

Create the database separately, then run the entry point from the project root:

```powershell
psql -v ON_ERROR_STOP=1 -d univoice_database -f database/univoice_schema.sql
```

## Schema Files & Dependency Order

| File | Contents | Dependencies |
| --- | --- | --- |
| `schema/00_extensions_and_schemas.sql` | `pgcrypto`, `btree_gist`, and `reporting` schema | PostgreSQL superuser/admin extensions permissions |
| `schema/01_departments.sql` | `departments` and `department_authority_levels` | Extensions |
| `schema/02_users_and_authentication.sql` | `users`, `refresh_tokens`, and `student_profiles` | Departments |
| `schema/03_staff_positions_and_profiles.sql` | `staff_positions` and `staff_profiles` | Users |
| `schema/04_staff_hierarchy.sql` | `staff_department_memberships`, `staff_position_holdings`, `staff_supervisions`, `staff_department_authority_levels`, and `staff_department_work_settings` | Staff profiles, positions, departments, authority levels |
| `schema/05_categories_and_authorizations.sql` | `categories` (with initial authority queue routing) and `staff_category_authorizations` | Departments, authority levels, staff profiles |
| `schema/06_requests.sql` | `requests` and `request_ref_seq` | Categories, departments, authority levels, student profiles |
| `schema/07_assignments.sql` | `request_assignments` and active assignment uniqueness | Requests, staff profiles, departments |
| `schema/07_assistance.sql` | Compatibility, assistance tasks, assignments, history, transfers, reopening, messages, read receipts, and attachment metadata | Requests, request assignments, staff, categories, departments |
| `schema/08_escalations.sql` | `request_escalations` (queue-based escalation between authority tiers) | Requests, assignments, authority levels, staff profiles |
| `schema/09_request_history.sql` | `request_history` (append-only lifecycle audit trail) | Requests, users |
| `schema/10_comments_and_attachments.sql` | `comments` and `attachments` metadata (with request-consistency FK) | Requests, users |
| `schema/11_notifications.sql` | `notifications` | Users, requests, escalations |
| `schema/11_assistance_notifications.sql` | Optional assistance-task link on notifications | Assistance tasks, notifications |
| `schema/12_audit_logs.sql` | `audit_logs` (administrative/security actions) | Users |
| `schema/13_cyclic_relationship_constraints.sql` | Deferred composite FKs linking current assignment/escalation pointers to matching request IDs | Requests, assignments, escalations |
| `schema/14_functions.sql` | Trigger functions and procedural APIs (`claim_request`, `escalate_request_to_queue`, `set_staff_unavailable`) | Operational tables |
| `schema/14_assistance_functions.sql` | Shared request/assistance capacity assertion and database-authoritative request claim | Request and assistance assignments, staff settings |
| `schema/15_triggers.sql` | Immutability, updated_at, lifecycle tracking, and cycle prevention triggers | Tables and functions |
| `schema/15_assistance_triggers.sql` | Assistance immutability and update-time triggers | Assistance tables and functions |
| `schema/16_indexes.sql` | Partial unique indexes and operational authority queue polling indexes | Tables |
| `schema/16_assistance_indexes.sql` | Assistance queue, history, capacity, and notification indexes | Assistance tables, notifications |
| `schema/17_reporting_views.sql` | Views for operational summaries, SLA metrics, escalations, and workload monitoring | Operational tables and `reporting` schema |

## Migration Scripts for Existing Databases

For existing or previously populated databases, use the versioned migration script:
- [`migrations/V001__queue_based_authority_architecture.sql`](./migrations/V001__queue_based_authority_architecture.sql): Idempotent, transaction-safe migration upgrading an existing schema to the queue-based authority architecture.

Run via `psql`:
```powershell
psql -v ON_ERROR_STOP=1 -d univoice_database -f database/migrations/V001__queue_based_authority_architecture.sql
```

For an existing database, apply applicable migrations in order through V005, then apply
[`V006__interdepartmental_assistance_schema.sql`](./migrations/V006__interdepartmental_assistance_schema.sql).
V006 checks for V005's `request_transfers`, immutable initial-category trigger, transfer invalidation
trigger, and transfer assignment source before making changes. Do not edit V005 to retrofit an
already-installed schema. The repository does not contain a migration ledger, so inspect the target
database before applying migrations. The V005 application state for the development database has
not been verified.

For a fresh database, apply the master schema, then V005, then V006. V006 is safe after the master
schema because its schema modules are idempotent; V005 supplies the permanent-transfer structures
that the V006 preflight requires.

V006 updates the SQL `claim_request()` capacity check to lock the staff/department work-settings row
and count request plus assistance assignments. An assistance claim operation is not yet implemented,
so unified claim enforcement is not complete until that path uses the shared helper.

## Validation & Test Suite

The test suite validates all 12 operational scenarios including atomic claiming, concurrency locking, queue escalation, capacity enforcement, staff unavailability cascade, and integrity constraints:
- [`tests/schema_validation_test.sql`](../tests/schema_validation_test.sql)

Run test suite:
```powershell
psql -v ON_ERROR_STOP=1 -d univoice_database -f tests/schema_validation_test.sql
```

Assistance constraints have a separate disposable-database suite:
```powershell
psql -v ON_ERROR_STOP=1 -d univoice_test -f tests/schema_assistance_validation.sql
```
