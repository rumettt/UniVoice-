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
| **Phase 5** | Staff Queues, Escalation & Approvals | ⏳ Upcoming | — |
| **Phase 6** | Notifications & Real-Time Updates | ⏳ Upcoming | — |

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
