# UniVoice PostgreSQL Design

Initial schema entry point: `database/univoice_schema.sql`  
Ordered schema files: `database/schema/`  
Migration script: `database/migrations/V001__queue_based_authority_architecture.sql`  
Validation suite: `tests/schema_validation_test.sql`  

Database name: **univoice_database**

---

## 1. Architectural Overview & Workflow Model

UniVoice enables university students to submit requests without needing to navigate complex institutional hierarchies. The database enforces a **queue-based, department-authority-level routing and manual claiming model**:

1. **Student Request Submission**:
   - The student selects a request category (`categories.id`).
   - The system retrieves the pre-configured `department_id` and `initial_authority_level_id` directly from the database.
   - The request is created in `status = 'pending'`, `current_assignment_id = NULL`, entering that department's specific authority queue.

2. **Manual Queue Claiming**:
   - Eligible staff claim requests from their department queues using `claim_request(request_id, staff_id)`.
   - Before granting a claim, the database verifies:
     - Active department membership (`staff_department_memberships`).
     - Category authorization (`staff_category_authorizations.can_handle = TRUE`).
     - Authority level eligibility under the **Threshold Rule** (staff authority level order >= request authority level order).
     - Staff availability (`staff_department_work_settings.is_available = TRUE`).
     - Workload capacity (active assignments count < effective capacity limit).
     - Request is still unassigned (`SELECT ... FOR UPDATE` lock).

3. **Queue-Based Escalation**:
   - When a staff member cannot resolve a request within their authority, they invoke `escalate_request_to_queue(request_id, staff_id, reason)`.
   - The existing assignment ends (`ended_at = NOW()`).
   - The system advances `current_authority_level_id` to the next higher level in that department (`level_order > current_level_order`).
   - **Final-Level Policy**: If the request is already at the highest authority level for that department, the database raises an exception (`check_violation`).
   - The request returns to `status = 'pending'` and enters the higher-level queue for eligible senior staff to claim.
   - An escalation record is appended to `request_escalations`.

4. **Staff Unavailability & Assignment Re-queueing**:
   - When a staff member becomes unavailable (`set_staff_unavailable`), all active unfinished assignments are closed and requests return to `status = 'pending'`.
   - Each request remains in its current authority queue (escalated requests stay in their elevated tier).

---

## 2. Core Entities & Relationships

```
departments 1──* department_authority_levels
departments 1──* categories
departments 1──* requests (responsible_department_id)
departments 1──* staff_department_memberships
departments 1──* staff_department_work_settings

department_authority_levels 1──* categories (initial_authority_level_id)
department_authority_levels 1──* requests (current_authority_level_id)
department_authority_levels 1──* staff_department_authority_levels
department_authority_levels 1──* request_escalations (from/to levels)

users 1──0..1 student_profiles
users 1──0..1 staff_profiles
staff_profiles 1──* staff_department_memberships
staff_profiles 1──* staff_department_authority_levels
staff_profiles 1──* staff_department_work_settings
staff_profiles 1──* staff_category_authorizations
staff_profiles 1──* staff_position_holdings
staff_profiles 1──* request_assignments

requests 1──* request_assignments
requests 1──* request_escalations
requests 1──* request_history
requests 1──* comments 1──* attachments
requests 1──* attachments
requests 1──* notifications
```

---

## 3. Database Integrity & Constraints

1. **Category & Department Consistency**:
   - `categories (initial_authority_level_id, department_id)` references `department_authority_levels (id, department_id)`.
   - A category cannot point to an authority level from another department.

2. **Request & Department Consistency**:
   - `requests (category_id, responsible_department_id)` references `categories (id, department_id)`.
   - `requests (current_authority_level_id, responsible_department_id)` references `department_authority_levels (id, department_id)`.

3. **Current Assignment Strict Consistency**:
   - `requests (id, current_assignment_id)` references `request_assignments (request_id, id)`.
   - Guaranteed at DB level: `requests.current_assignment_id` can only reference an assignment belonging to that same request.

4. **One Active Assignment per Request**:
   - `CREATE UNIQUE INDEX uq_request_assignments_one_active ON request_assignments (request_id) WHERE ended_at IS NULL;`

5. **Attachment-to-Comment-to-Request Consistency**:
   - `attachments (comment_id, request_id)` references `comments (id, request_id)`.
   - Prevents an attachment from referencing a comment belonging to a different request.

6. **Hierarchy Cycle Prevention**:
   - `prevent_supervision_cycle()` trigger acquires a transactional advisory lock (`pg_advisory_xact_lock`) ensuring concurrent supervisory links cannot form cycles.

---

## 4. Operational Procedural Functions

- `claim_request(p_request_id, p_staff_user_id)`: Atomic queue claiming with eligibility, availability, capacity, and authority checks.
- `escalate_request_to_queue(p_request_id, p_staff_user_id, p_reason, p_notes)`: Ends assignment, advances request to the next department authority tier, and records escalation.
- `set_staff_unavailable(p_staff_user_id, p_department_id)`: Re-queues unfinished assignments and sets availability to `FALSE`.

---

## 5. Confirmed Architectural Decisions

1. **Authority Claiming Rule**: Threshold rule. Staff with higher authority level order can claim requests at their own level or any lower level within their department.
2. **Final-Level Escalation Policy**: Raise exception. Requests at the department's highest authority tier cannot be escalated further; senior staff must resolve, reject, or handle them.
3. **Multi-Department Positions**: Department-scoped. Staff can hold positions in multiple departments, with uniqueness enforced per `(staff_user_id, department_id)`.
4. **File Organization**: Strict file partitioning. Schema files 09–12 have each table aligned to its eponymous SQL file.
