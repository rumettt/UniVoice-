/**
 * Integration test: concurrent claims by the same staff member at capacity = 1.
 *
 * REQUIREMENTS
 * ============
 * - Set TEST_DATABASE_URL to a *disposable* test database that has the full UniVoice
 *   schema applied (run `psql -d <testdb> -f database/univoice_schema.sql`).
 * - TEST_DATABASE_URL must NOT contain "univoice_database" (the development DB name).
 *   The test refuses to run if that guard fails.
 *
 * WHAT IS TESTED
 * ==============
 * When a staff member has max_active_requests_override = 1 and two pending requests
 * exist in their department, two concurrent transactions each attempt to claim a
 * different request. The two-phase locking strategy (request row lock → work-settings
 * row lock) must ensure exactly one claim succeeds and the other is rejected with a
 * capacity violation — no over-subscription is possible.
 *
 * HOW TO RUN
 * ==========
 *   $env:TEST_DATABASE_URL = "postgresql://postgres:password@localhost:5432/univoice_test"
 *   npx vitest run tests/integration/staffQueue.concurrent.test.ts
 *
 * The test cleans up its own seed rows in afterAll.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from 'pg';
import { randomUUID } from 'crypto';

// ---------------------------------------------------------------------------
// Guard: refuse to run without TEST_DATABASE_URL or against the dev database
// ---------------------------------------------------------------------------
const TEST_DB_URL = process.env.TEST_DATABASE_URL ?? '';

const shouldSkip =
  !TEST_DB_URL ||
  TEST_DB_URL.includes('univoice_database');

if (!TEST_DB_URL) {
  console.warn(
    '[integration] TEST_DATABASE_URL is not set — skipping concurrent claim tests.',
  );
} else if (TEST_DB_URL.includes('univoice_database')) {
  throw new Error(
    'TEST_DATABASE_URL must point to a disposable test database, not "univoice_database".',
  );
}

// ---------------------------------------------------------------------------
// Seed IDs — all use deterministic UUIDs so afterAll can delete them exactly
// ---------------------------------------------------------------------------
const DEPT_ID     = randomUUID();
const STAFF_ID    = randomUUID();   // user + staff_profile
const CAT_ID      = randomUUID();
const LEVEL_ID    = randomUUID();
const STUDENT_ID  = randomUUID();   // request submitter
const REQ_ID_A    = randomUUID();
const REQ_ID_B    = randomUUID();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeClient(): Client {
  return new Client({ connectionString: TEST_DB_URL });
}

/** Seed the minimum rows needed for the concurrent-claim test. */
async function seed(db: Client): Promise<void> {
  // Department
  const DEPT_NAME = `Integration Test Dept ${DEPT_ID}`;
  const DEPT_CODE = `INT${DEPT_ID.slice(0, 8).replace(/-/g, '').toUpperCase()}`;
  await db.query(
    `INSERT INTO departments (id, name, code, default_max_active_requests, is_active)
     VALUES ($1, $2, $3, 5, TRUE)
     ON CONFLICT (name) DO NOTHING`,
    [DEPT_ID, DEPT_NAME, DEPT_CODE],
  );

  // Staff user + staff_profile
  const STAFF_EMAIL = `intstaff_${STAFF_ID}@test.local`;
  await db.query(
    `INSERT INTO users (id, first_name, last_name, email, password_hash, role,
                        primary_department_id, is_active)
     VALUES ($1, 'Int', 'Staff', $2, 'x', 'staff', $3, TRUE)
     ON CONFLICT (email) DO NOTHING`,
    [STAFF_ID, STAFF_EMAIL, DEPT_ID],
  );
  await db.query(
    `INSERT INTO staff_profiles (user_id, employee_number)
     VALUES ($1, $2)`,
    [STAFF_ID, `STF-${STAFF_ID.slice(0, 8)}`],
  );

  // Department membership
  await db.query(
    `INSERT INTO staff_department_memberships
       (staff_user_id, department_id, is_primary, valid_from)
     VALUES ($1, $2, TRUE, NOW())`,
    [STAFF_ID, DEPT_ID],
  );

  // Work settings — override capacity to 1
  await db.query(
    `INSERT INTO staff_department_work_settings
       (staff_user_id, department_id, is_available, max_active_requests_override)
     VALUES ($1, $2, TRUE, 1)`,
    [STAFF_ID, DEPT_ID],
  );

  // Authority level
  await db.query(
    `INSERT INTO department_authority_levels
       (id, department_id, name, code, level_order, is_active)
     VALUES ($1, $2, 'Level 1', 'L1', 1, TRUE)`,
    [LEVEL_ID, DEPT_ID],
  );

  // Authority assignment for staff
  await db.query(
    `INSERT INTO staff_department_authority_levels
       (staff_user_id, department_authority_level_id, department_id, valid_from)
     VALUES ($1, $2, $3, NOW())`,
    [STAFF_ID, LEVEL_ID, DEPT_ID],
  );

  // Category
  await db.query(
    `INSERT INTO categories
       (id, department_id, initial_authority_level_id, name, is_active)
     VALUES ($1, $2, $3, 'Integration Category', TRUE)`,
    [CAT_ID, DEPT_ID, LEVEL_ID],
  );

  // Category authorization for staff
  await db.query(
    `INSERT INTO staff_category_authorizations
       (staff_user_id, category_id, can_handle, valid_from)
     VALUES ($1, $2, TRUE, NOW())`,
    [STAFF_ID, CAT_ID],
  );

  // Student submitter (needed for FK on requests)
  const STUDENT_EMAIL = `intstudent_${STUDENT_ID}@test.local`;
  await db.query(
    `INSERT INTO users (id, first_name, last_name, email, password_hash, role, is_active)
     VALUES ($1, 'Int', 'Student', $2, 'x', 'student', TRUE)`,
    [STUDENT_ID, STUDENT_EMAIL],
  );
  await db.query(
    `INSERT INTO student_profiles (user_id, student_number)
     VALUES ($1, $2)`,
    [STUDENT_ID, `STU-${STUDENT_ID.slice(0, 8)}`],
  );

  // Two pending requests
  for (const [reqId, idx] of [
    [REQ_ID_A, 'A'],
    [REQ_ID_B, 'B'],
  ]) {
    await db.query(
      `INSERT INTO requests
         (id, public_ref, student_id, created_by, category_id, responsible_department_id,
          current_authority_level_id, title, description, priority, status)
       VALUES ($1, $2, $3, $3, $4, $5, $6, 'Int Test Request', 'Test description', 'medium', 'pending')`,
      [reqId, `REQ-${reqId.slice(0, 8)}-${idx}`, STUDENT_ID, CAT_ID, DEPT_ID, LEVEL_ID],
    );
  }
}

/** Remove all seed rows in reverse dependency order. */
async function cleanup(db: Client): Promise<void> {
  // Temporarily disable the immutability trigger to allow test cleanup
  await db.query(`ALTER TABLE request_history DISABLE TRIGGER trg_request_history_immutable`);
  await db.query(`ALTER TABLE request_assignments DISABLE TRIGGER trg_request_assignments_immutable`);
  try {
    await db.query(
      `UPDATE requests SET status = 'pending', current_assignment_id = NULL WHERE id IN ($1, $2)`,
      [REQ_ID_A, REQ_ID_B],
    );
    await db.query(
      `DELETE FROM request_assignments WHERE request_id IN ($1, $2)`,
      [REQ_ID_A, REQ_ID_B],
    );
    await db.query(
      `DELETE FROM request_history WHERE request_id IN ($1, $2)`,
      [REQ_ID_A, REQ_ID_B],
    );
    await db.query(
      `DELETE FROM requests WHERE id IN ($1, $2)`,
      [REQ_ID_A, REQ_ID_B],
    );
  } finally {
    await db.query(`ALTER TABLE request_history ENABLE TRIGGER trg_request_history_immutable`);
    await db.query(`ALTER TABLE request_assignments ENABLE TRIGGER trg_request_assignments_immutable`);
  }
  await db.query(
    `DELETE FROM student_profiles WHERE user_id = $1`,
    [STUDENT_ID],
  );
  await db.query(`DELETE FROM users WHERE id = $1`, [STUDENT_ID]);
  await db.query(
    `DELETE FROM staff_category_authorizations WHERE staff_user_id = $1`,
    [STAFF_ID],
  );
  await db.query(`DELETE FROM categories WHERE id = $1`, [CAT_ID]);
  await db.query(
    `DELETE FROM staff_department_authority_levels WHERE staff_user_id = $1`,
    [STAFF_ID],
  );
  await db.query(
    `DELETE FROM department_authority_levels WHERE id = $1`,
    [LEVEL_ID],
  );
  await db.query(
    `DELETE FROM staff_department_work_settings WHERE staff_user_id = $1`,
    [STAFF_ID],
  );
  await db.query(
    `DELETE FROM staff_department_memberships WHERE staff_user_id = $1`,
    [STAFF_ID],
  );
  await db.query(`DELETE FROM staff_profiles WHERE user_id = $1`, [STAFF_ID]);
  await db.query(`DELETE FROM users WHERE id = $1`, [STAFF_ID]);
  await db.query(`DELETE FROM departments WHERE id = $1`, [DEPT_ID]);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe.skipIf(shouldSkip)(
  'Concurrent claim — same staff, two requests, capacity 1 (integration)',
  () => {
    let seedDb: Client;
    let db1: Client;
    let db2: Client;

    beforeAll(async () => {
      seedDb = makeClient();
      await seedDb.connect();
      await seed(seedDb);
    });

    afterAll(async () => {
      try {
        await cleanup(seedDb);
      } finally {
        await seedDb.end();
        // Ensure connections released even if test failed mid-transaction
        try { await db1?.end(); } catch { /* ignore */ }
        try { await db2?.end(); } catch { /* ignore */ }
      }
    });

    it('exactly one concurrent claim succeeds; the other is rejected for capacity', async () => {
      db1 = makeClient();
      db2 = makeClient();
      await db1.connect();
      await db2.connect();

      // Both transactions begin
      await Promise.all([db1.query('BEGIN'), db2.query('BEGIN')]);

      // --- Phase 1: each locks a DIFFERENT request row (FOR UPDATE) --------
      // This models two concurrent HTTP calls to POST /staff/requests/:id/claim
      // targeting different request IDs in parallel.
      const [row1, row2] = await Promise.all([
        db1.query(
          `SELECT responsible_department_id, status, current_assignment_id, deleted_at
           FROM requests WHERE id = $1 FOR UPDATE`,
          [REQ_ID_A],
        ),
        db2.query(
          `SELECT responsible_department_id, status, current_assignment_id, deleted_at
           FROM requests WHERE id = $1 FOR UPDATE`,
          [REQ_ID_B],
        ),
      ]);

      // Both requests exist and are pending
      expect(row1.rows[0].status).toBe('pending');
      expect(row1.rows[0].current_assignment_id).toBeNull();
      expect(row2.rows[0].status).toBe('pending');
      expect(row2.rows[0].current_assignment_id).toBeNull();

      const deptId1 = row1.rows[0].responsible_department_id as string;
      const deptId2 = row2.rows[0].responsible_department_id as string;
      expect(deptId1).toBe(DEPT_ID);
      expect(deptId2).toBe(DEPT_ID);

      // --- Phase 2: both attempt work-settings row lock --------------------
      // Only ONE can hold this lock at a time — the second blocks.
      // We race them: whichever acquires the lock first calls claim_request(),
      // the other must wait and then discover capacity is exhausted.
      const claimViaDb = async (db: Client, reqId: string): Promise<string> => {
        await db.query(
          `SELECT 1 FROM staff_department_work_settings
           WHERE staff_user_id = $1 AND department_id = $2
           FOR UPDATE`,
          [STAFF_ID, DEPT_ID],
        );
        const res = await db.query(
          `SELECT claim_request($1, $2) AS assignment_id`,
          [reqId, STAFF_ID],
        );
        await db.query('COMMIT');
        return res.rows[0].assignment_id as string;
      };

      const results = await Promise.allSettled([
        claimViaDb(db1, REQ_ID_A),
        claimViaDb(db2, REQ_ID_B),
      ]);

      // Roll back any transaction that did not commit
      for (const db of [db1, db2]) {
        try { await db.query('ROLLBACK'); } catch { /* already committed */ }
      }

      const successes = results.filter((r) => r.status === 'fulfilled');
      const failures  = results.filter((r) => r.status === 'rejected');

      // Exactly one claim succeeds; one fails
      expect(successes).toHaveLength(1);
      expect(failures).toHaveLength(1);

      const failureReason = (failures[0] as PromiseRejectedResult).reason as Error;
      // PostgreSQL raises check_violation from claim_request() capacity check
      expect(failureReason.message).toMatch(/at capacity/i);

      // Verify DB state: exactly one request is now 'assigned', one is still 'pending'
      const stateRes = await seedDb.query(
        `SELECT id, status FROM requests WHERE id IN ($1, $2) ORDER BY id`,
        [REQ_ID_A, REQ_ID_B],
      );
      const statuses = stateRes.rows.map((r) => r.status as string);
      expect(statuses.filter((s) => s === 'assigned')).toHaveLength(1);
      expect(statuses.filter((s) => s === 'pending')).toHaveLength(1);

      // Verify exactly one active assignment exists for this staff member
      const assignRes = await seedDb.query(
        `SELECT COUNT(*)::int AS cnt
         FROM request_assignments
         WHERE assignee_id = $1 AND ended_at IS NULL`,
        [STAFF_ID],
      );
      expect(assignRes.rows[0].cnt).toBe(1);
    }, 30_000); // 30 s timeout — covers any lock wait
  },
);
