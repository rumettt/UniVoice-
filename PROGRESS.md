# UniVoice — Implementation Progress

This document tracks project implementation milestones, completed phases, key architectural decisions, outstanding technical verification, and current status. It serves as the primary technical reference and handoff guide.

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
| **Phase 7, M1** | Request Return and Escalation | ✅ Completed | 2026-11-13 |
| **Phase 7, M2** | Closed-Request Communication & Messaging | ✅ Completed | 2026-11-14 |
| **Phase 7, M3** | Permanent Transfers | ✅ Completed | 2026-11-14 |
| **Phase 7, M4** | Interdepartmental Assistance | 🚧 Stage 2 database foundation implemented in workspace; not applied to a database | — |

---

## Verification Snapshot (Audit: 2026-11-14)

- **TypeScript Typecheck (`npm run typecheck`)**: Passed with 0 errors (`tsc --noEmit`).
- **Production Build (`npm run build`)**: Success (compiled to `dist/` without errors).
- **Vitest Unit Test Suite (`npm test`)**:
  - **19 test files passed**, 0 failed.
  - **187 unit tests passed**, 0 failed.
- **PostgreSQL Integration Tests (Concurrency Suite)**:
  - 3 test files, 4 tests skipped:
    - `tests/integration/requestWorkflow.concurrent.test.ts` (1 test skipped)
    - `tests/integration/staffQueue.concurrent.test.ts` (1 test skipped)
    - `tests/integration/staffReturnEscalate.concurrent.test.ts` (2 tests skipped)
  - **Reason**: Skipped because `TEST_DATABASE_URL` was not configured in the test environment.
  - **Status**: Live PostgreSQL concurrency, row-level locking, and transactional procedures remain **unverified against a real database instance**. Mocked unit tests verify application routing, error mapping, and service logic only; they do not establish database-level concurrency safety.

### Milestone 4 Stage 2 implementation status (2026-11-14)

- Assistance schema modules and forward migration V006 are present in the workspace.
- V006 requires a complete V005 state and does not modify V005. The target database could not be queried because the configured database password was unavailable; V005 and V006 application status are therefore **unverified**.
- `assert_staff_assignment_capacity()` locks the existing work-settings row and counts active request plus assistance assignments. `claim_request()` uses this helper.
- The next-stage parent-resolution guard must include undeleted `pending` tasks with `ever_claimed_at IS NOT NULL`; only undeleted pending tasks with no prior claim are auto-cancelled.
- Assistance claiming and queue-preview integration are not implemented. Unified capacity is not yet an end-to-end guarantee; no assistance claim API is enabled.
- `tests/schema_assistance_validation.sql` was added but could not be executed because `psql` and a working PostgreSQL connection are unavailable. SQL constraints are not reported as database-verified.
- The approved business decisions and this implementation status supersede earlier M4 planning text and unresolved-decision notes below.

---

## Phase 7: Escalation & Reassignment — Milestone 4: Interdepartmental Assistance (Planning Specification)

> **IMPLEMENTATION STATUS: Stage 2 schema and request-capacity SQL are implemented in the workspace; migration and database verification are pending. Earlier planning notes below are historical and superseded by the approved final implementation specification.**

### 1. Agreed Business Rules

#### A. Ownership, Accountability & Task Creation
- **Original Accountability**: The original student request retains its `responsible_department_id`. The original handler remains assigned, accountable, and continues consuming staff capacity in the originating department.
- **Multiple Simultaneous Tasks**: One parent request can have multiple assistance tasks across different supporting departments at the same time. Supporting staff cannot create chained assistance tasks.
- **Task Creation Parameters**: The original handler creates assistance tasks by selecting:
  - Supporting department.
  - Authority level within that department.
  - Supporting category (must be configured as compatible with parent request).
  - Task title.
  - Task description.
  - Reason for requesting assistance.
  - Priority (independent of the parent request's priority).
- **Queue Preservation**: Tasks enter the selected authority queue. If no staff member is immediately available, the task remains in that queue; there is **no automatic authority downgrade**.

#### B. Supporting Staff Workflow
- Supporting staff manually discover and claim eligible tasks from their department's queue under the Threshold Rule (`staff_level >= target_level`).
- Claiming consumes staff workload capacity in the supporting department.
- Supporting staff can:
  - Start processing an assigned task (`assigned -> in_progress`).
  - Return an assigned or in-progress task to its same authority queue with a mandatory reason. Returning ends the active assignment and releases capacity.
  - Complete the task by submitting a mandatory outcome message describing the work performed. **Completion submits the task for review; it does not close the task.** Completion ends the active assignment and releases capacity.
  - Reject the task with a mandatory reason. Rejection ends the active assignment, releases capacity, and sends the task back to the original handler. **The original handler receives the rejection and decides what happens next; rejection does not automatically close or cancel the task.**

#### C. Original Handler Review & Lifecycle Finalization
- **Acceptance & Closure**: The original handler reviews completed work and can officially accept and close the task with a **mandatory closing message**. Sets `closed_at`.
- **Corrections Cycle**: The original handler can return a completed task for corrections with a **mandatory reason**.
  - Corrections can repeat indefinitely (`correction_count` increments).
  - The task returns to the same supporting authority-level queue as `pending`.
  - Eligible supporting staff (including previous handlers) may claim it again.
  - All previous assignments, messages, attachments, and history remain preserved.
- **Cancellation**: The original handler can cancel an assistance task with a mandatory reason. Cancellation ends any active supporting assignment and releases capacity.
- **Soft Deletion vs Cancellation**:
  - An assistance task can be soft-deleted (`deleted_at = NOW()`) **only if it has never been claimed** (`ever_claimed_at IS NULL`), accompanied by a mandatory audit record.
  - Once a task has been claimed, it can **never be deleted**; it may only be cancelled.
  - Tasks cannot be edited after creation. If unclaimed, the original handler may delete and recreate it.

#### D. Reopening Closed Assistance Tasks
- **Eligibility & Window**: Previous supporting handlers may request reopening within a configurable **three-week window** (21 days default) after closure.
- **Mandatory Explanation**: The reopening request requires a non-empty explanation.
- **Decision Authority**: The original request handler reviews the request and decides to approve or decline.
- **Declining**: Declining leaves the task `closed` and requires a **mandatory recorded decline reason**.
- **Approval**: Approval re-queues the task in `pending` status at its **original authority level**, not directly to the previous handler. It enters the queue for eligible supporting staff to claim.
- **Limits**: Multiple reopening requests are permitted within the 21-day window, but **at most one reopening request may be pending at any time**. There is no arbitrary maximum lifetime reopen count.

#### E. Administrative Capabilities & Boundaries
- Administrators can:
  - View and audit all assistance tasks across all departments.
  - Force-cancel any assistance task regardless of status with a mandatory reason.
  - Reassign an assigned/in-progress task to an eligible supporting staff member (verifying membership, authority, and capacity).
  - Inspect all task conversations and attachments for audit purposes.
  - Initiate supporting-department transfers (redirecting the task to another department), subject to receiving staff acceptance or rejection.
  - Monitor workloads, delays, response times, completion times, and rejection rates.
- **Boundary**: Administrative task closure and correction requests are **not granted** by default (marked as an unresolved decision below).

#### F. Messaging & Attachment Privacy
- **Private Two-Way Conversation**: Private messaging is provided strictly between the current original handler and current supporting handler.
- **Attachments & Read Tracking**: File attachments are supported (with magic-byte validation). Read state and unread counts are tracked per-user.
- **Persistence Across Assignment Cycles**: Complete conversation history persists across returns, correction cycles, reassignments, and department transfers.
- **Historical Access**: Authorized past handlers access conversation history based on verified assignment records. Administrators have read-only audit access.
- **Student Privacy**:
  - Students cannot access internal assistance conversations, task descriptions, reasons, notes, or staff identities.
  - Students see only whether assistance is currently in progress and the supporting department's name.
  - When assistance is rejected or cancelled, students see only a generic "assistance ended" state, without internal reasons or outcome details.

#### G. Notifications & Monitoring
- **Event-Driven In-App Alerts**: Notifications are generated in the same transaction as the workflow event and sent **only to relevant eligible users** (verifying active account, active membership, authority threshold, category authorization, and availability).
- **Admin Exclusion**: Administrators do not receive ordinary event notifications; they use the administrative dashboard.
- **Performance Reporting Metrics**: The admin dashboard tracks response time, completion time, rejection rate, workload distribution, and overdue delays.

---

### 2. Proposed Technical Design (Awaiting Implementation Review)

#### A. Database Schema Additions (Migration `V006`)
1. **`department_category_compatibilities`**: Defines compatible category mappings between originating categories (`requests.initial_category_id`) and supporting department categories.
2. **`request_assistance_tasks`**: Primary entity storing `ever_claimed_at`, `due_at`, `correction_count`, `reopen_count`, and `deleted_at`.
3. **`request_assistance_assignments`**: Supporting staff handling intervals, enforcing `UNIQUE (assistance_task_id) WHERE ended_at IS NULL`.
4. **`request_assistance_history`**: Dedicated append-only audit table protected by `prevent_mutation()`, referencing `(assistance_task_id, request_id)` with `ON DELETE RESTRICT`.
5. **`request_assistance_department_transfers`**: Admin-initiated supporting department transfer with acceptance/rejection by receiving staff.
6. **`request_assistance_reopen_requests`**: Reopen requests from past handlers within the 21-day window. Enforces at most one pending request per task.
7. **`request_assistance_messages` & `request_assistance_message_reads`**: Two-way messaging with per-user read tracking.
8. **`request_assistance_attachments`**: Attachment metadata linked to tasks and messages via composite foreign key `(message_id, assistance_task_id)`.
9. **`notifications.assistance_task_id`**: Nullable foreign key addition.

#### B. Parent Request Lifecycle Synchronization Trigger (`trg_requests_assistance_lifecycle_sync`)
- Attached `BEFORE UPDATE OF status, responsible_department_id ON requests`.
- **Resolution Guard**: Blocks parent request resolution (`in_progress -> resolved`) if active assistance tasks exist (`assigned`, `in_progress`, `completed`, `transfer_pending`). **Preserves completed work awaiting review without accidental cancellation.**
- **Unclaimed Task Cancellation**: Cancels pending, never-claimed assistance tasks atomically upon parent request resolution.
- **Disruption Cascading**: On parent return, escalation, transfer, or rejection, atomically cancels all in-flight assistance tasks, cancels pending department transfers and reopen requests, and ends active assignments to release supporting capacity.

#### C. Global Lock Sequence
$$\text{Parent Request} \;\longrightarrow\; \text{Assistance Task} \;\longrightarrow\; \text{Staff Work Settings (Capacity)}$$

---

### 3. Unresolved Decisions Requiring Explicit Approval

1. **Single-Level Department Policy**: Proposed that in a department where $\text{min\_order} = \text{max\_order}$, the sole level is treated as the lowest tier (staff cannot initiate assistance tasks without administrative assistance). Awaiting explicit approval.
2. **Administrative Closure & Correction Permissions**: The agreed rule assigns task closure and requesting corrections strictly to the original request handler. Whether administrators should be granted override permissions to accept/close or request corrections on assistance tasks remains an open decision.
3. **Priority Deadline Durations**: Initial default hours for `urgent`, `high`, `medium`, and `low` assistance tasks are not hardcoded. Initial values must be explicitly decided for deployment configuration in `system_settings`.

---

## Outstanding Technical Risks and Verification

The following technical items require rigorous verification during Milestone 4 implementation and must not be assumed resolved:

1. **Unified Capacity Enforcement in Existing Code**:
   - `claim_request` in `database/schema/14_functions.sql` currently counts only `request_assignments`. It must be updated in migration `V006` to include `request_assistance_assignments`.
   - The queue eligibility CTE in `src/repositories/staffQueue.repository.ts` must be verified to incorporate the unified count.
2. **Shared Work-Settings Row Locking & Provisioning Invariant**:
   - Both claim operations must lock `staff_department_work_settings` row `FOR UPDATE` before reading active workloads.
   - If a work-settings row is unexpectedly missing, the claim procedure must abort with an error rather than silently provisioning availability defaults.
3. **Parent Request Lifecycle Synchronization**:
   - The proposed trigger `trg_requests_assistance_lifecycle_sync` must be tested to ensure the `resolved -> closed` transition in `resolveRequest` does not cause duplicate checks, recursive trigger loops, or conflicting updates.
4. **Referential Integrity for Assistance History**:
   - `request_assistance_history` must enforce composite foreign keys `(assistance_task_id, request_id)` to guarantee a task's history cannot be associated with the wrong parent request.
   - All history references must use `ON DELETE RESTRICT`.
5. **Department Transfer Rejection Safety**:
   - On transfer rejection, if the prior handler has become unavailable, inactive, or unauthorized, the task must safely return to the supporting queue rather than restoring an invalid active assignment.
6. **Notification Delivery & Inactive User Guards**:
   - Ordinary event notifications must strictly exclude administrators and filter out inactive or unavailable staff.
7. **Lock Ordering Verification**:
   - All multi-resource operations must follow `Parent Request -> Assistance Task -> Staff Work Settings` to eliminate deadlocks.
8. **Real PostgreSQL Concurrency & Migration Testing**:
   - All concurrency guarantees (competing claims, cancellation races, capacity limits) must be verified against an actual running PostgreSQL instance using `TEST_DATABASE_URL`.

---

## Phase 7: Escalation & Reassignment — Milestone 3: Permanent Transfers (Completed)

### 1. Implemented Features
- **Transfer Initiation (`POST /api/v1/staff/requests/:requestId/transfers`)**:
  - Initiated by middle- or highest-authority staff, or administrators. Lowest-tier staff receive `403 Forbidden`.
  - Three-tier authority ceiling: Middle-tier initiators cannot target the receiving department's apex authority level (`400 Bad Request`). Apex and administrators can target any active receiving level.
  - Receiving department must be active and distinct from current department.
  - At most one pending transfer per request (`409 Conflict`).
- **Transfer Acceptance (`POST /api/v1/staff/transfers/:transferId/accept`)**:
  - Receiving department staff with active membership, authority level $\ge$ target level, and category authorization can accept incoming transfers.
  - Administrators cannot directly accept on behalf of receiving staff (`403 Forbidden`).
  - Atomically terminates the original handler's assignment (releasing capacity), updates request ownership (`responsible_department_id`, `category_id`, `current_authority_level_id`, `status = 'pending'`, `current_assignment_id = NULL`), marks transfer `accepted`, and records history.
- **Transfer Rejection (`POST /api/v1/staff/transfers/:transferId/reject`)**:
  - Receiving staff can reject with a mandatory `rejectionReason`.
  - Original department retains ownership; handler assignment and capacity remain occupied.
- **Admin Transfer Monitoring (`GET /api/v1/admin/transfers`)**:
  - Cross-department visibility into pending transfers.
- **Original Category Immutability**:
  - `requests.initial_category_id` stores the student's original category permanently, protected by trigger `trg_requests_protect_initial_category`.
- **Pending Transfer Invalidation**:
  - Trigger `trg_requests_invalidate_pending_transfer` auto-cancels pending transfers if the parent request is returned, escalated, resolved, closed, or rejected.

### 2. Files Added & Modified in Milestone 3
- `database/migrations/V005__permanent_transfers.sql`
- `src/validators/transfer.validators.ts`
- `src/repositories/transfer.repository.ts`
- `src/services/staff/transfer.service.ts`
- `src/controllers/transfer.controller.ts`
- `src/routes/v1/transfer.router.ts`
- `src/repositories/request.repository.ts`
- `src/routes/v1/index.ts`
- `tests/unit/transfer.test.ts` (12 unit tests, 100% passing)

---

## Phase 7: Escalation & Reassignment — Milestone 2: Closed-Request Communication and Messaging (Completed)

### 1. Implemented Features
- **Student Messaging on Closed Requests (`POST /api/v1/requests/:requestId/messages`)**:
  - Allows students to post follow-up messages on their own `closed` requests.
  - Sending a message does **NOT** alter the request status (it remains `closed`).
  - Strict privacy and anti-enumeration: Request must exist, be closed, and belong to the authenticated student (`404 Not Found` for other students).
  - Messages are saved to `comments` with `visibility = 'student_visible'`.
- **Student Conversation Retrieval (`GET /api/v1/requests/:requestId/messages`)**:
  - Allows students to fetch student-visible messages on their closed requests, with pagination (`page`, `limit`).
- **Staff Conversation Retrieval (`GET /api/v1/staff/requests/:requestId/messages`)**:
  - Allows the last assigned staff handler to inspect the closed request's conversation.
  - Non-handlers receive `403 Forbidden`.
- **Staff Reply (`POST /api/v1/staff/requests/:requestId/messages`)**:
  - Last handler staff can send a response to the student, preserving conversation history and keeping status `closed`.
- **Staff Reopening (`POST /api/v1/staff/requests/:requestId/reopen-closed`)**:
  - Replaces student-facing direct reopening. Last handler staff can reopen an eligible closed request with a mandatory non-empty reason.
  - Enforces system settings (`maxReopenCount`, `reopenWindowDays`) and increments `reopen_count`.
  - Re-queues the request in `pending` status at the preserved authority level with `current_assignment_id = NULL`.
- **Staff Rejection of Further Action (`POST /api/v1/staff/requests/:requestId/reject-further`)**:
  - Last handler staff can permanently deny further action with an explanation visible to the student (`comments` table) and logged in `request_history` (`action = 'further_action_rejected'`).
  - Request remains `closed`.
- **Deprecation of Student Reopen Endpoint (`POST /api/v1/requests/:requestId/reopen`):**
  - Returns `410 Gone` with a helpful message directing the student to post a message instead.
- **Provider-Independent Attachment Storage Abstraction (`src/utils/storage`):**
  - Storage adapter interface (`store`, `getSignedUrl`, `delete`) decoupling storage backends from PostgreSQL metadata.
  - `LocalStorageAdapter` for development and testing with UUID-prefixed safe filenames and path-traversal guards.
  - S3-compatible interface ready for production deployment.
  - Attachment upload endpoints (`POST /api/v1/requests/:requestId/messages/attachments` and `POST /api/v1/staff/requests/:requestId/messages/attachments`) with MIME validation and size limits.
  - Secure authorized download (`GET /api/v1/attachments/:attachmentId`) with access checks for student owners, staff handlers, and admins.

### 2. Database & Performance Refinements
- Database migration `database/migrations/V004__messaging.sql` adds covering index `idx_comments_request_visible_paginate` on `comments(request_id, created_at ASC) WHERE deleted_at IS NULL AND visibility = 'student_visible'`.
- Greenfield schema `16_indexes.sql` updated to include the performance index.

### 3. Focused Verification & Hardening Results
- **A. Last-Handler Identification**: Hardened `getLastHandler` in `messaging.repository.ts` to sort by `(ended_at IS NULL) DESC, COALESCE(ended_at, started_at) DESC, started_at DESC`, guaranteeing the staff member who actually brought the request to resolution/closure is selected rather than an earlier returned assignee whose started_at might be ambiguous in rapid reassignment cycles.
- **B. Unavailable Last Handler**: Verified that student messages remain associated with the last handler, do not enter any general queue, and do not change request status (`closed` preserved).
- **C. Attachment Security**:
  - Implemented `validateBufferContent` in `messaging.service.ts` checking magic bytes (rejects executables including Windows PE `MZ`, Linux ELF, Mach-O, and verifies file signatures for PDF `%PDF`, JPEG, PNG, GIF, and WebP).
  - Enforced strict authorization against request ownership and handler context for all downloads.
- **D. Storage & Database Consistency**: Verified transactional isolation and rollback cleanup logic: if the metadata insertion fails, the uploaded storage file is immediately cleaned up via `storageAdapter.delete()`.
- **E. Staff Reopening Policy Alignment**: Aligned `reopenRequestByStaff()` in `requestWorkflow.repository.ts` with student reopening rules, adding an explicit check that rejects attempts to reopen `rejected` requests (`400 Bad Request`, `rejection_final`).
- **Test Suite Status at Milestone 2 Completion**: 18 test files, 175 unit tests passing. Production build and typecheck passing with zero errors.

---

## Phase 7: Escalation & Reassignment — Milestone 1: Request Return and Escalation (Completed)

### 1. Implemented Features
- **Return to Queue (`POST /api/v1/staff/requests/:requestId/return`)**:
  - Allows the currently assigned staff member to return an assigned or in-progress request back to its department queue.
  - Strict ownership guard: Only the active handler may return the request; attempts by other staff members are rejected with `403 Forbidden`.
  - Operational status validation: Requests in `pending`, `resolved`, `closed`, or `rejected` status cannot be returned and are rejected with `400 Bad Request`. Nonexistent or deleted requests return `404 Not Found`.
  - Mandatory reason: Requires a non-empty, trimmed `reason` validated with Zod. Missing or whitespace-only reasons are rejected with `400 Bad Request`.
  - Capacity release: Ends the active assignment in `request_assignments` (`ended_at = NOW()`), immediately reducing the staff member's active assignment count and restoring capacity.
  - Queue restoration: Sets request `status = 'pending'` and resets `current_assignment_id = NULL`.
  - Department and authority tier preservation: Responsible department and `current_authority_level_id` are strictly preserved without resetting to initial category queues.
  - Immutable audit history: Records `returned_to_queue` action in `request_history` along with structured JSON details (`reason`, `department_id`, `authority_level_id`).
  - Reclaim capability: The previous handler remains eligible to reclaim the request through standard queue claiming if another staff member has not claimed it first.
- **Request Escalation (`POST /api/v1/staff/requests/:requestId/escalate`)**:
  - Exposes the authoritative database procedure `escalate_request_to_queue(p_request_id, p_staff_user_id, p_reason, p_notes)`. Zero duplicate business logic in TypeScript.
  - Strict ownership guard: Only the currently assigned handler can escalate the request (`403 Forbidden` for other staff members).
  - Mandatory reason and optional notes: Requires non-empty `reason` and supports optional context notes.
  - Monotonic authority queue advancement: Advances request exactly one authority tier higher within the same department (`level_order > current_level_order`).
  - Capacity release: Ends active assignment (`ended_at = NOW()`) and sets `status = 'pending'` in the elevated queue with `current_assignment_id = NULL`.
  - Escalation history: Inserts sequential record into `request_escalations` (`status = 'queued'`) and logs `escalated` event in `request_history`. Links `requests.current_escalation_id` to the active escalation.
  - Highest-tier protection: Rejects escalation attempts when a request is already at the highest authority level for its department with `400 Bad Request` (`check_violation`).
  - Repeated escalation: Allows subsequent escalations after senior staff claim the request, up until the highest authority tier.
- **Database Refinements & Procedural Functions (`database/migrations/V003__return_and_escalation.sql`)**:
  - Added PostgreSQL procedural function `return_request_to_queue(p_request_id, p_staff_user_id, p_reason)`.
  - Added soft-deletion guard (`deleted_at IS NOT NULL`) to `escalate_request_to_queue`.
  - Refined `claim_request()` escalation handling to explicitly verify active queued status (`status = 'queued'`) before setting source to `escalation_claim`.
  - Synchronized greenfield master schema in `database/schema/14_functions.sql`.

---

## Phases 1–6 Architectural Summary

- **Phase 1 (Backend Foundation)**: Express, TypeScript, pg pool, centralized error handling, Zod env validation, health routes.
- **Phase 2 (Auth & RBAC)**: Argon2id, JWT access + hashed refresh tokens in PostgreSQL, atomic rotation, family replay detection.
- **Phase 3 (Users & Departments)**: User provisioning transactions, department CRUD, effective-dated memberships and work settings.
- **Phase 4 (Request Submission)**: Student request submission deriving initial department and authority queue directly from categories.
- **Phase 5 (Staff Queues & Claiming)**: Database-authoritative `claim_request()` procedure with capacity and authority Threshold Rule checks.
- **Phase 6 (Workflows & Reopening)**: In-progress transitions, atomic resolution, closure window, student reopening limits.

---

## Codex Handoff & Development Guidelines

When continuing development on UniVoice, follow these strict working rules:

1. **Read Documentation First**:
   - Thoroughly read `PROGRESS.md`, `README.md`, `database/DESIGN.md`, and `database/README.md` before making changes.
2. **Inspect Actual Code Before Modifying**:
   - Inspect the actual TypeScript files in `src/` and SQL schemas in `database/schema/`. Do not assume documentation matches implementation.
3. **Milestone 4 Is Approved and In Progress**:
   - Follow the user's staged implementation instructions and approved final specification.
   - Do not revive business decisions marked final in that specification.
4. **Preserve Database-Authoritative Architecture**:
   - UniVoice relies on PostgreSQL procedures and constraints for concurrency, capacity, and state transitions. Do not duplicate business logic in TypeScript that belongs in database transactions.
5. **Enforce Unified Staff Capacity**:
   - When implementing Milestone 4, verify that `claim_request` and `claim_assistance_task` serialize against the same `staff_department_work_settings` row and enforce the identical combined workload formula.
6. **Work Incrementally**:
   - Follow the sequence: Database migration $\rightarrow$ Repositories/Validators $\rightarrow$ Services $\rightarrow$ Controllers/Routes $\rightarrow$ Unit & Integration Tests.
   - Typecheck (`npm run typecheck`), build (`npm run build`), and test (`npm test`) after each incremental step.


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
