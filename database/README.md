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
| `schema/08_escalations.sql` | `request_escalations` (queue-based escalation between authority tiers) | Requests, assignments, authority levels, staff profiles |
| `schema/09_request_history.sql` | `request_history` (append-only lifecycle audit trail) | Requests, users |
| `schema/10_comments_and_attachments.sql` | `comments` and `attachments` metadata (with request-consistency FK) | Requests, users |
| `schema/11_notifications.sql` | `notifications` | Users, requests, escalations |
| `schema/12_audit_logs.sql` | `audit_logs` (administrative/security actions) | Users |
| `schema/13_cyclic_relationship_constraints.sql` | Deferred composite FKs linking current assignment/escalation pointers to matching request IDs | Requests, assignments, escalations |
| `schema/14_functions.sql` | Trigger functions and procedural APIs (`claim_request`, `escalate_request_to_queue`, `set_staff_unavailable`) | Operational tables |
| `schema/15_triggers.sql` | Immutability, updated_at, lifecycle tracking, and cycle prevention triggers | Tables and functions |
| `schema/16_indexes.sql` | Partial unique indexes and operational authority queue polling indexes | Tables |
| `schema/17_reporting_views.sql` | Views for operational summaries, SLA metrics, escalations, and workload monitoring | Operational tables and `reporting` schema |

## Migration Scripts for Existing Databases

For existing or previously populated databases, use the versioned migration script:
- [`migrations/V001__queue_based_authority_architecture.sql`](./migrations/V001__queue_based_authority_architecture.sql): Idempotent, transaction-safe migration upgrading an existing schema to the queue-based authority architecture.

Run via `psql`:
```powershell
psql -v ON_ERROR_STOP=1 -d univoice_database -f database/migrations/V001__queue_based_authority_architecture.sql
```

## Validation & Test Suite

The test suite validates all 12 operational scenarios including atomic claiming, concurrency locking, queue escalation, capacity enforcement, staff unavailability cascade, and integrity constraints:
- [`tests/schema_validation_test.sql`](../tests/schema_validation_test.sql)

Run test suite:
```powershell
psql -v ON_ERROR_STOP=1 -d univoice_database -f tests/schema_validation_test.sql
```
