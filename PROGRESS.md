# UniVoice — Implementation Progress

This document tracks project implementation milestones, completed phases, key architectural decisions, and current status.

---

## Phase Summary

| Phase | Description | Status | Completed At |
|---|---|---|---|
| **Phase 1** | Project Setup & Backend Foundation | ✅ Completed | 2026-11-03 |
| **Phase 2** | Authentication & Core Authorization | ✅ Completed | 2026-11-05 |
| **Phase 3** | User & Department Management | ✅ Completed | 2026-11-06 |
| **Phase 4** | Request Submission & Student Workflow | ✅ Completed | 2026-11-09 |
| **Phase 5** | Staff Queues, Escalation & Approvals | ✅ Completed | 2026-11-09 |
| **Phase 6** | Request Workflow & Student Reopening | ✅ Completed | 2026-11-12 |
| **Phase 7** | Escalation & Reassignment | 🟡 In Progress (Milestone 1 Completed) | — |

---

## Phase 7: Escalation & Reassignment — Milestone 1: Request Return and Escalation (Completed)

### 1. Implemented Features

- **Return to Queue (`POST /api/v1/staff/requests/:requestId/return`):**
  - Allows the currently assigned staff member to return an assigned or in-progress request back to its department queue.
  - Strict ownership guard: Only the active handler may return the request; attempts by other staff members are rejected with `403 Forbidden`.
  - Operational status validation: Requests in `pending`, `resolved`, `closed`, or `rejected` status cannot be returned and are rejected with `400 Bad Request`. Nonexistent or deleted requests return `404 Not Found`.
  - Mandatory reason: Requires a non-empty, trimmed `reason` validated with Zod. Missing or whitespace-only reasons are rejected with `400 Bad Request`.
  - Capacity release: Ends the active assignment in `request_assignments` (`ended_at = NOW()`), immediately reducing the staff member's active assignment count and restoring capacity.
  - Queue restoration: Sets request `status = 'pending'` and resets `current_assignment_id = NULL`.
  - Department and authority tier preservation: Responsible department and `current_authority_level_id` are strictly preserved without resetting to initial category queues.
  - Immutable audit history: Records `returned_to_queue` action in `request_history` along with structured JSON details (`reason`, `department_id`, `authority_level_id`).
  - Reclaim capability: The previous handler remains eligible to reclaim the request through standard queue claiming if another staff member has not claimed it first.
- **Request Escalation (`POST /api/v1/staff/requests/:requestId/escalate`):**
  - Exposes the authoritative database procedure `escalate_request_to_queue(p_request_id, p_staff_user_id, p_reason, p_notes)`. Zero duplicate business logic in TypeScript.
  - Strict ownership guard: Only the currently assigned handler can escalate the request (`403 Forbidden` for other staff members).
  - Mandatory reason and optional notes: Requires non-empty `reason` and supports optional context notes.
  - Monotonic authority queue advancement: Advances request exactly one authority tier higher within the same department (`level_order > current_level_order`).
  - Capacity release: Ends active assignment (`ended_at = NOW()`) and sets `status = 'pending'` in the elevated queue with `current_assignment_id = NULL`.
  - Escalation history: Inserts sequential record into `request_escalations` (`status = 'queued'`) and logs `escalated` event in `request_history`. Links `requests.current_escalation_id` to the active escalation.
  - Highest-tier protection: Rejects escalation attempts when a request is already at the highest authority level for its department with `400 Bad Request` (`check_violation`).
  - Repeated escalation: Allows subsequent escalations after senior staff claim the request, up until the highest authority tier.
- **Database Refinements & Procedural Functions (`database/migrations/V003__return_and_escalation.sql`):**
  - Added PostgreSQL procedural function `return_request_to_queue(p_request_id, p_staff_user_id, p_reason)`.
  - Added soft-deletion guard (`deleted_at IS NOT NULL`) to `escalate_request_to_queue`.
  - Refined `claim_request()` escalation handling to explicitly verify active queued status (`status = 'queued'`) before setting source to `escalation_claim`, ensuring requests returned to queue after escalation and reclaimed default cleanly to `claim`.
  - Synchronized greenfield master schema in `database/schema/14_functions.sql` and validation suite in `tests/schema_validation_test.sql` (15 tests passing).

### 2. Architectural Decisions & Boundaries

1. **Authoritative Procedural Logic:**
   - Both return-to-queue and escalation are implemented directly in PostgreSQL procedures (`return_request_to_queue` and `escalate_request_to_queue`), providing transactional atomicity and preventing business logic duplication between backend and database layers.
2. **Deterministic Row Locking:**
   - Row-level `FOR UPDATE` locks on `requests` prevent concurrent state corruption between simultaneous claim, return, and escalation requests.
3. **Capacity Release Guarantee:**
   - Terminating active assignments via `ended_at = NOW()` immediately decrements active workload counts evaluated by both queue CTEs and claim capacity constraints (`active_count < effective_capacity`).
4. **Clean Domain History Attribution:**
   - Domain actions (`returned_to_queue`, `escalated`, `claimed`) are explicitly recorded with contextual metadata (reasons, levels, sequences) without duplicate history entries inserted by application code.

### 3. Files Created & Modified

#### Created
- `database/migrations/V003__return_and_escalation.sql`: Migration script adding `return_request_to_queue`, soft-delete guards, and active escalation status checks.
- `tests/integration/staffReturnEscalate.concurrent.test.ts`: PostgreSQL concurrency tests for return, escalation, and higher-tier claiming workflows.

#### Modified
- `database/schema/14_functions.sql`: Added `return_request_to_queue` and updated `escalate_request_to_queue` and `claim_request` for greenfield deployments.
- `src/validators/requestWorkflow.validators.ts`: Added strict Zod schemas for `returnRequestSchema` and `escalateRequestSchema`.
- `src/repositories/requestWorkflow.repository.ts`: Added transactional `returnRequest` and `escalateRequest` repository methods.
- `src/services/staff/staffWorkflow.service.ts`: Added `returnRequest` and `escalateRequest` methods with error mappings for check violations and access controls.
- `src/controllers/staffWorkflow.controller.ts`: Added Express handlers for `returnRequest` and `escalateRequest`.
- `src/routes/v1/staffQueue.router.ts`: Mounted `POST /requests/:requestId/return` and `POST /requests/:requestId/escalate`.
- `tests/unit/staffWorkflow.test.ts`: Added 18 unit tests (tests 16–33) covering return, escalation, role guards, invalid statuses, highest-tier rejection, and repository transactions.
- `tests/schema_validation_test.sql`: Added Tests 13–15 validating return, assignment termination, reason constraints, and reclaimability at the SQL level.
- `PROGRESS.md`: Documented Milestone 1 progress and architectural decisions.
- `README.md`: Documented return and escalation endpoints.

### 4. Tests Performed & Results

- **Vitest Unit Test Suite:**
  - 17 test files, 157 unit tests, **100% passing**.
- **TypeScript Typecheck:**
  - `tsc --noEmit` passed with 0 errors.
- **Production Build:**
  - `npm run build` compiled successfully to `dist/`.

---

## Phase 6: Request Workflow & Student Reopening (Completed)

### 1. Implemented Features

- **Start Processing (`PATCH /api/v1/staff/requests/:requestId/start`):**
  - Allows the currently assigned staff member to transition a claimed request from `assigned` to `in_progress`.
  - Strict authorization: Only the assigned handler can start processing; other staff members are rejected with `403 Forbidden`.
  - Validates operational status: Requests in `pending`, `in_progress`, `resolved`, `closed`, or `rejected` are rejected with `400 Bad Request`.
  - Preserves assignment intervals and atomic audit history.
- **Atomic Request Resolution (`POST /api/v1/staff/requests/:requestId/resolve`):**
  - Staff resolution requires mandatory resolution classification (`resolutionCategory`) and a non-empty resolution message (`resolutionMessage` / `resolution_notes`).
  - Allowed resolution classifications: `'resolved_fully'`, `'workaround_provided'`, `'information_provided'`, `'referred_to_external'`, `'other'`.
  - Atomic two-step transition: Transitions `in_progress` → `resolved`, and immediately automatically to `closed` within a single database transaction.
  - Releases staff capacity: Ends the active assignment in `request_assignments` (`ended_at = NOW()`), decreasing staff active workload count.
  - Immutably anchors reopening time window: Sets `first_closed_at = COALESCE(first_closed_at, NOW())` on first closure, guaranteeing subsequent reopenings never reset the reopening window.
  - Preserves separate lifecycle events in `request_history` via database trigger `trg_requests_lifecycle_history` with full contextual details.
- **Request Rejection (`POST /api/v1/staff/requests/:requestId/reject`):**
  - Staff can reject requests in either `assigned` or `in_progress` status.
  - Mandatory non-empty rejection reason stored on the request (`rejection_reason`) and recorded in history.
  - Releases staff capacity: Ends the active assignment in `request_assignments` (`ended_at = NOW()`).
  - Transitions status to `rejected` and records `rejected_at = NOW()`.
  - Rejection is final: Rejection cannot be challenged or reopened by students.
- **Student Reopening (`POST /api/v1/requests/:requestId/reopen`):**
  - Allows owning students to reopen closed requests back to `pending` queue without administrative approval.
  - Student ownership guard: Students can only reopen requests they submitted; other students receive generic `404 Not Found` without information leakage.
  - Database-backed global configuration: Reopening time window (default 7 days) and maximum reopening count (default 2, allowed 1–5) are enforced on the backend.
  - Window immutability: Reopening window evaluates strictly against the immutable `first_closed_at` timestamp and is never reset by reopenings.
  - Authority queue preservation: The reopened request retains its existing `current_authority_level_id` (does not reset to the category's initial queue).
  - Previous assignment remains in history as inactive (`ended_at` remains set); request assignment pointer resets to `NULL` to enter the department queue. Previous staff handler remains eligible to reclaim if normal eligibility criteria are met.
- **Enhanced Student Request Tracking (`GET /api/v1/requests/:requestId`):**
  - Exposes public reference, request title, description, status, priority, department, and category.
  - Displays assigned or handling staff member (public name and university email only).
  - Surfaces resolution outcome (category and message) and rejection reason.
  - Dynamic reopening availability: Returns `isAllowed`, `remainingReopenings`, `maxReopenCount`, `windowExpiresAt`, and `remainingWindowSeconds`.
  - Student-safe timeline history: Chronological list of lifecycle transitions with actor attribution and event reasons; strictly redacts internal admin metadata and IDs.
- **Database-Backed Workflow Settings Administration (`/api/v1/admin/settings/request-workflow`):**
  - Dedicated `system_settings` table stores dynamic global platform settings.
  - `GET /api/v1/admin/settings/request-workflow`: Allows administrators to inspect current configuration.
  - `PATCH /api/v1/admin/settings/request-workflow`: Allows administrators to configure `reopenWindowDays` (>= 1) and `maxReopenCount` (1–5).

### 2. Architectural Decisions & Boundaries

1. **Zero History Duplication with Contextual Triggers:**
   - Rather than manually inserting status history rows in TypeScript, the PostgreSQL trigger `trg_requests_lifecycle_history` (`record_request_lifecycle_change()`) was enhanced to log rich structured context (`source`, `resolution_category`, `resolution_notes`, `rejection_reason`, `reopen_reason`, `reopen_count`) directly within each database transition.
2. **Deterministic Row Locking:**
   - All state mutations (`start`, `resolve`, `reject`, `reopen`) acquire `FOR UPDATE` row locks on `requests`, serializing concurrent workflows and preventing double-reopens, invalid status bypasses, or race conditions.
3. **Immutable Closure Anchor for Reopening Window:**
   - `first_closed_at` is set via `COALESCE(first_closed_at, NOW())` upon first closure and is never overwritten. All reopening eligibility calculations strictly evaluate against this immutable deadline.
4. **Information Leakage & Data Privacy:**
   - Single request detail and reopening endpoints return generic `404 Not Found` when accessed by another student, preventing ID enumeration. Student tracking timelines only expose student-safe information.

### 3. Files Created & Modified

#### Created
- `database/migrations/V002__request_workflow.sql`: Migration script adding workflow columns, constraints, system settings, and enriched lifecycle history triggers.
- `database/schema/18_system_settings.sql`: Greenfield master schema for global system settings.
- `src/validators/requestWorkflow.validators.ts`: Zod schemas for resolve, reject, and reopen inputs.
- `src/validators/systemSettings.validators.ts`: Zod schemas for administrative workflow settings.
- `src/repositories/requestWorkflow.repository.ts`: Data access layer for row-locked start, resolve, reject, and reopen transactions.
- `src/repositories/systemSettings.repository.ts`: Repository for database-backed workflow configuration.
- `src/services/staff/staffWorkflow.service.ts`: Staff workflow business logic.
- `src/services/admin/systemSettings.service.ts`: Admin settings service.
- `src/controllers/staffWorkflow.controller.ts`: Express controller for staff workflow actions.
- `src/controllers/systemSettings.controller.ts`: Express controller for admin settings.
- `src/routes/v1/systemSettings.router.ts`: Router mounted at `/api/v1/admin/settings`.
- `tests/unit/systemSettings.test.ts`: 7 unit tests covering settings retrieval, updates, boundary validations, and role protection.
- `tests/unit/staffWorkflow.test.ts`: 15 unit tests covering start, resolve, reject, assignments, and authorization.
- `tests/unit/requestReopenTracking.test.ts`: 10 unit tests covering student reopening limits, windows, tracking, and ownership.
- `tests/integration/requestWorkflow.concurrent.test.ts`: Real PostgreSQL concurrency test for concurrent reopening attempts.

#### Modified
- `database/schema/06_requests.sql`: Added `resolution_category`, `rejection_reason`, `first_closed_at`, `last_reopen_reason`, and check constraints.
- `database/schema/14_functions.sql`: Enhanced `record_request_lifecycle_change()` with contextual event logging.
- `database/univoice_schema.sql`: Included `18_system_settings.sql`.
- `src/repositories/request.repository.ts`: Added workflow columns, student tracking queries, and history retrieval.
- `src/services/student/request.service.ts`: Added `reopenRequest` and enhanced `getRequestDetails`.
- `src/controllers/request.controller.ts`: Added `reopenRequest` handler.
- `src/routes/v1/staffQueue.router.ts`: Mounted `/requests/:requestId/start`, `/resolve`, `/reject`.
- `src/routes/v1/request.router.ts`: Mounted `/requests/:requestId/reopen`.
- `src/routes/v1/index.ts`: Mounted `/admin/settings` route.
- `PROGRESS.md`: Documented Phase 6 milestones and architectural decisions.
- `README.md`: Documented Phase 6 endpoints and request workflow lifecycle.

### 4. Tests Performed & Results

- **Vitest Unit Test Suite:**
  - 17 test files, 139 tests, **100% passing**.
- **TypeScript Typecheck:**
  - `tsc --noEmit` passed with 0 errors.
- **Production Build:**
  - `npm run build` compiled successfully to `dist/`.

---

## Phase 5: Staff Request Queue & Claiming (Completed)

### 1. Implemented Features

- **Eligible Staff Queue (`GET /api/v1/staff/queue`):**
  - Strict eligibility filtering: Staff members only see requests they are eligible to claim across all their active department memberships.
  - Eligibility invariants enforced in SQL:
    1. Request `status = 'pending'` and `current_assignment_id IS NULL`.
    2. Request is not soft-deleted (`deleted_at IS NULL`).
    3. Staff has active membership in the request's department (`valid_to IS NULL OR valid_to > NOW()`).
    4. Threshold Rule: Staff authority level order >= request authority level order.
    5. Staff is authorized to handle the request category (`staff_category_authorizations.can_handle = TRUE`).
    6. Staff is available in that department (`staff_department_work_settings.is_available = TRUE`).
    7. Staff has remaining capacity in that department (`active_assignments < effective_capacity`).
  - Multi-department staff support: Aggregates eligible requests across all active department memberships with independent capacity and availability resolution.
  - Query filters: Optional `departmentId` and `priority` filters.
  - Priority ordering: Deterministically ordered by `urgent` (1) → `high` (2) → `medium` (3) → `low` (4), oldest submission first (`created_at ASC`), with deterministic tie-breaker on `id ASC`.
  - Queue payload: Returns lightweight response including preview description (truncated at 150 chars), `waitingDurationSeconds`, department, category, and authority details.
  - Strict pagination: Enforces boundaries with a maximum limit of 100 requests per page.
- **Eligible Request Inspection (`GET /api/v1/staff/queue/:requestId`):**
  - Allows staff to inspect full details of an individual request before claiming.
  - Revalidates all 8 eligibility rules. Returns `404 Not Found` if ineligible or not claimable to prevent cross-department information leakage and ID enumeration.
  - Opening details is strictly read-only: does not claim, reserve, mutate state, or create history records.
- **Atomic Request Claiming (`POST /api/v1/staff/requests/:requestId/claim`):**
  - Authoritative procedural execution: calls the database procedural function `claim_request(p_request_id, p_staff_user_id)`.
  - Concurrency & Capacity Protection:
    1. Row lock on `requests` (`FOR UPDATE`) resolves competing staff claims on the same request.
    2. Row lock on `staff_department_work_settings` (`FOR UPDATE`) serializes claims by the same staff member in that department, guaranteeing simultaneous claims of different requests cannot exceed capacity.
  - State transitions: Sets `status = 'assigned'`, updates `current_assignment_id`, and creates an active handling interval in `request_assignments` (`source = 'claim'`, `ended_at = NULL`).
  - Lifecycle audit history: Trigger `trg_requests_lifecycle_history` records `status_changed`, while `claim_request` records the `claimed` event. Zero duplicate history entries inserted by application.
  - Precise error mappings: Maps PostgreSQL error codes to typed `AppError` responses (`404` for nonexistent/inaccessible, `409` for already-claimed and capacity conflicts, and `403` for unavailable/unauthorized).
- **My Active Assignments (`GET /api/v1/staff/requests/me`):**
  - Returns only requests actively assigned to the authenticated staff member (`ended_at IS NULL` and `requests.current_assignment_id = request_assignments.id`).
  - Excludes ended historical assignments.
  - Supports optional department and status (`assigned` vs `in_progress`) filters with pagination.

### 2. Architectural Decisions & Boundaries

1. **Single Authoritative Procedural Implementation:**
   - Rather than duplicating the complex 12-check eligibility and state transition logic in TypeScript, the backend delegates claiming to PostgreSQL's `claim_request()`, maintaining a single source of truth.
2. **Deterministic Two-Phase Row Locking:**
   - Concurrency is protected by a strict lock hierarchy: Request Row Lock (`requests`) → Staff-Dept Row Lock (`staff_department_work_settings`). This completely eliminates hash collision risks of advisory locks, avoids table-level locks, and prevents deadlocks.
3. **Queue and Claim-Time Invariant Consistency:**
   - Both the queue CTE and `claim_request` evaluate active assignments (`ended_at IS NULL`) and effective capacity (`COALESCE(override, dept_default, 5)`) identically.
4. **Information Leakage Prevention:**
   - Single queue inspection (`GET /api/v1/staff/queue/:requestId`) returns `404 Not Found` when a request belongs to an unauthorized department or authority tier.

### 3. Files Created & Modified

#### Created
- `src/validators/staffQueue.validators.ts`: Zod schemas for queue discovery, claim parameters, and my-assignments queries.
- `src/repositories/staffQueue.repository.ts`: Repository executing multi-department eligibility CTEs, row-locked claim transactions, and active assignment queries.
- `src/services/staff/staffQueue.service.ts`: Business logic orchestrating queue discovery, waiting durations, preview formatting, and error mappings.
- `src/controllers/staffQueue.controller.ts`: Express controller for staff queue endpoints.
- `src/routes/v1/staffQueue.router.ts`: Staff router with authentication and `requireRole('staff')`.
- `tests/unit/staffQueue.test.ts`: 21 comprehensive unit tests covering all eligibility, multi-department, claiming, concurrency, capacity, availability, and assignment scenarios.

#### Modified
- `src/routes/v1/index.ts`: Mounted `/staff` router.
- `PROGRESS.md`: Documented Phase 5 milestones, architectural decisions, and verification.
- `README.md`: Documented Phase 5 endpoints, permissions, and query parameters.

### 4. Tests Performed & Results

- **Vitest Unit Test Suite:**
  - 14 test files, 107 tests, **100% passing**.
- **TypeScript Typecheck:**
  - `tsc --noEmit` passed with 0 errors.
- **Production Build:**
  - `tsc` compiled successfully to `dist/`.

---

## Phase 4: Request Submission & Initial Routing (Completed)

### 1. Implemented Features

- **Student Request Submission (`POST /api/v1/requests`):**
  - Authenticated student submits requests with category selection, title, and description.
  - Student identity taken directly from trusted `req.user.id` (associated with `student_profiles`).
  - Strict validation (`.strict()`) prevents mass assignment or client overriding of department, initial authority level, assignment, or status.
  - Fully transactional routing verification: acquires row-level `FOR SHARE` locks on `categories`, `departments`, and `department_authority_levels` to verify active status and department alignment under concurrency.
  - Public reference generation: atomically generates `public_ref` via `request_ref_seq` formatted as `REQ-YYYY-XXXXX` (with at least 5 digits, preserving values beyond 5 digits).
  - Rule-based initial routing: automatically determines the responsible department and initial authority queue from trusted database category configuration.
  - Initial request state: begins in `pending` status with `current_assignment_id = NULL` in the department's authority queue.
  - Lifecycle audit history: relies on the database trigger `trg_requests_lifecycle_history` to append the initial creation record atomically without duplicating history records.
- **Student Request Retrieval (`GET /api/v1/requests/me`):**
  - Returns paginated list of requests submitted exclusively by the authenticated student.
  - Supports SQL-level filtering by `status` and `categoryId`.
  - Excludes soft-deleted records (`deleted_at IS NULL`).
  - Enforces pagination boundaries (page >= 1, limit 1–100, default 10) and returns complete metadata (`page`, `limit`, `total`, `totalPages`).
- **Individual Request Details (`GET /api/v1/requests/:requestId`):**
  - Returns full request details including joined category, responsible department, and current authority level.
  - Strict ownership guard: students can only access their own submitted requests; attempting to access another student's request or a nonexistent request returns `404 Not Found` without leaking data.
  - Excludes soft-deleted requests (`deleted_at IS NULL`).

### 2. Architectural Decisions & Boundaries

1. **Rule-Based Routing & Shared Row Locking:**
   - Within the submission transaction, row-level `FOR SHARE` locks are acquired on `categories`, `departments`, and `department_authority_levels` to eliminate race conditions with concurrent administrative reconfiguration.
2. **Zero History Duplication:**
   - PostgreSQL trigger `trg_requests_lifecycle_history` automatically creates the initial `'submitted'` history record in `request_history` within the submission transaction. The application avoids inserting duplicate audit records.
3. **Information Leakage Prevention:**
   - Cross-student access attempts to `GET /api/v1/requests/:requestId` return generic 404 responses, preventing malicious enumeration of request IDs.
4. **Database Constraint Integrity:**
   - Relies on composite foreign keys `(category_id, responsible_department_id)` and `(current_authority_level_id, responsible_department_id)` as the underlying database integrity layer.

### 3. Files Created & Modified

#### Created
- `src/validators/request.validators.ts`: Zod schemas for submission, pagination, and query filtering.
- `src/repositories/request.repository.ts`: Data access layer for requests with shared row locks, sequence formatting, and SQL filtering.
- `src/services/student/request.service.ts`: Business logic for transactional routing, validation, ownership checks, and SLA calculation.
- `src/controllers/request.controller.ts`: Express controller for student request endpoints.
- `src/routes/v1/request.router.ts`: Student-only routes with authentication and role authorization.
- `tests/unit/request.test.ts`: 21 comprehensive unit tests covering submission, routing, validation, privacy, transactions, and error handling.

#### Modified
- `src/routes/v1/index.ts`: Mounted `/requests` router.
- `PROGRESS.md`: Documented Phase 4 implementation milestones.
- `README.md`: Documented Phase 4 student request endpoints and workflow.

### 4. Tests Performed & Results

- **Vitest Unit Test Suite:**
  - 13 test files, 86 tests, **100% passing**.
- **TypeScript Typecheck:**
  - `tsc --noEmit` passed with 0 errors.
- **Production Build:**
  - `tsc` compiled successfully to `dist/`.

---

## Phase 3: User & Department Management (Completed)

### 1. Implemented Features

- **Administrative User Provisioning (`POST /api/v1/users`):**
  - Fully transactional student account creation: creates `users` (`primary_department_id = NULL`) and linked `student_profiles` (`student_number`, `program_name`).
  - Fully transactional staff account creation: enforces mandatory `primary_department_id`; atomically provisions `users`, `staff_profiles` (`employee_number`), initial primary membership in `staff_department_memberships`, and initialized work settings in `staff_department_work_settings`.
  - Admin account provisioning with optional department and staff profiles.
  - Argon2id password hashing integrated; zero plaintext passwords or hashes stored or returned.
  - Validation with Zod enforcing database regex patterns, phone formats, and role constraints.
- **User Retrieval & Profile Management:**
  - `GET /api/v1/users`: Paginated listing with filtering by `role`, `departmentId`, `isActive`, and search string.
  - `GET /api/v1/users/:id`: Safe single user retrieval including linked profile and primary department information.
  - `PATCH /api/v1/users/:id/profile`: Updating profile fields (`firstName`, `lastName`, `phone`, `profileImageUrl`).
  - `PATCH /api/v1/users/:id/status`: Account activation and deactivation maintaining `users_deactivated_consistency` (`(is_active = TRUE AND deactivated_at IS NULL) OR (is_active = FALSE AND deactivated_at IS NOT NULL)`) and revoking active refresh tokens on deactivation.
  - Built-in guard preventing administrators from deactivating their own accounts.
- **Department Management (`/api/v1/departments`):**
  - `POST /api/v1/departments`: Department creation validating uppercase codes (`^[A-Z0-9_]{2,20}$`) and positive default max active requests.
  - `GET /api/v1/departments`: Paginated list of departments.
  - `GET /api/v1/departments/:id`: Department detail endpoint returning dynamically derived metrics (`activeAuthorityLevelsCount`, `activeStaffCount`, `activeCategoriesCount`) without denormalization.
  - `PATCH /api/v1/departments/:id`: Update department name, description, and default request capacity.
  - `PATCH /api/v1/departments/:id/status`: Department activation and deactivation satisfying database status constraints.
- **Staff Department Appointments (`/api/v1/departments/:departmentId/staff`):**
  - Multi-department membership support: staff can belong to multiple departments concurrently.
  - Effective-dated appointment history: closing previous active memberships (`valid_to = NOW()`) rather than deleting or overwriting records.
  - Primary department management: automatically adjusts `users.primary_department_id` and demotes previous primary memberships.
  - `GET /api/v1/departments/:departmentId/staff`: List staff in a department.
  - `GET /api/v1/users/:staffUserId/departments`: List departments for a staff member.
  - `DELETE /api/v1/departments/:departmentId/staff/:staffUserId`: Ending staff appointments effective-dated.
- **Department-Specific Authority Hierarchy (`/api/v1/departments/:departmentId/authority-levels`):**
  - Department-scoped authority level creation maintaining monotonic positive `level_order`.
  - Collision-free safe reordering: utilizes a transactional offset strategy (`level_order + 10000`) to respect the unique `(department_id, level_order)` constraint during intermediate states.
  - Staff authority level assignment: links staff to authority tiers within their active department; verifies cross-department integrity and active department membership.
  - Preserves assignment history by ending previous active assignments before creating new ones.
  - `GET /api/v1/users/:staffUserId/authority-assignments`: Inspect authority tiers held across departments.
- **Staff Work Settings (`/api/v1/departments/:departmentId/staff/:staffUserId/work-settings`):**
  - Independent management of staff availability (`is_available`) and capacity overrides (`max_active_requests_override`).
  - Dynamic effective capacity resolution: inherits department `default_max_active_requests` when override is `NULL`.
- **Category Routing Management (`/api/v1/categories`):**
  - Category creation associating categories with responsible departments and initial authority queues.
  - Strict validation ensuring configured `initial_authority_level_id` belongs to the specified `department_id` and is active.
  - Distinction between active categories for student request submission and inactive categories managed by administrators.
  - Full CRUD and status toggle for categories.

### 2. Architectural Decisions & Boundaries

1. **Transactional Provisioning:**
   - Staff account creation is atomic across `users`, `staff_profiles`, `staff_department_memberships`, and `staff_department_work_settings`.
2. **Safe Authority Reordering:**
   - PostgreSQL unique constraints on `(department_id, level_order)` are preserved by applying a temporary offset (+10000) inside a transaction, eliminating intermediate collision errors without relaxing schema constraints.
3. **Effective-Dated History:**
   - Memberships and authority assignments close previous active records (`valid_to = NOW()`) rather than mutating historical records.
4. **Derived Metrics:**
   - Department metrics are computed on the fly using relationship joins and counts, preserving schema normalization.

### 3. Files Created & Modified

#### Created
- `src/validators/user.validators.ts`: Zod schemas for user provisioning, updates, and filtering.
- `src/validators/department.validators.ts`: Zod schemas for department management.
- `src/validators/staff.validators.ts`: Zod schemas for department memberships and work settings.
- `src/validators/authority.validators.ts`: Zod schemas for department authority levels and assignments.
- `src/validators/category.validators.ts`: Zod schemas for category creation and routing.
- `src/repositories/department.repository.ts`: Department database access and derived metrics.
- `src/repositories/staff.repository.ts`: Effective-dated membership and work settings repository.
- `src/repositories/authority.repository.ts`: Authority hierarchy and assignment repository with safe reordering.
- `src/repositories/category.repository.ts`: Request category database queries and routing targets.
- `src/services/admin/userManagement.service.ts`: Transactional user provisioning and profile service.
- `src/services/admin/department.service.ts`: Department management and metrics service.
- `src/services/admin/staffSettings.service.ts`: Staff appointments and work settings service.
- `src/services/admin/authority.service.ts`: Department authority hierarchy and assignment service.
- `src/services/admin/category.service.ts`: Category configuration service.
- `src/controllers/user.controller.ts`: User endpoints controller.
- `src/controllers/department.controller.ts`: Department endpoints controller.
- `src/controllers/staffSettings.controller.ts`: Staff membership and work settings controller.
- `src/controllers/authority.controller.ts`: Authority hierarchy and assignment controller.
- `src/controllers/category.controller.ts`: Category endpoints controller.
- `src/routes/v1/user.router.ts`: User management routes.
- `src/routes/v1/department.router.ts`: Department and staff membership routes.
- `src/routes/v1/category.router.ts`: Category management routes.
- `tests/unit/userManagement.test.ts`: 7 tests covering user creation, transactions, duplicate checks, and status.
- `tests/unit/department.test.ts`: 6 tests covering department lifecycle and metrics.
- `tests/unit/staffMembership.test.ts`: 4 tests covering appointments, effective dates, and multi-department support.
- `tests/unit/authority.test.ts`: 5 tests covering hierarchy, reordering, and cross-department enforcement.
- `tests/unit/staffSettings.test.ts`: 3 tests covering capacity overrides and availability.
- `tests/unit/category.test.ts`: 4 tests covering category creation, cross-department validation, and active status.

#### Modified
- `src/repositories/user.repository.ts`: Added administrative methods (`createStudent`, `createStaff`, `createAdmin`, `findAll`, `findDetailById`, `updateProfile`, `setStatus`).
- `src/routes/v1/index.ts`: Mounted `/users`, `/departments`, and `/categories`.
- `PROGRESS.md`: Updated Phase 3 implementation milestones.
- `README.md`: Documented Phase 3 endpoints, permissions, and request formats.

### 4. Tests Performed & Results

- **Vitest Unit Test Suite:**
  - 12 test files, 65 tests, **100% passing**.
- **TypeScript Typecheck:**
  - `tsc --noEmit` passed with 0 errors.
- **Production Build:**
  - `tsc` compiled successfully to `dist/`.

---

## Phase 2: Authentication & Core Authorization (Completed)

*(Details preserved from Phase 2)*
