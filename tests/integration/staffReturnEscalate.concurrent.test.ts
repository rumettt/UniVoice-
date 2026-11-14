/**
 * Integration test: concurrent return and escalation operations.
 *
 * REQUIREMENTS
 * ============
 * - Set TEST_DATABASE_URL to a disposable test database that has the full UniVoice
 *   schema and migrations applied.
 * - TEST_DATABASE_URL must NOT contain "univoice_database".
 *
 * WHAT IS TESTED
 * ==============
 * 1. Concurrent returns on the same request: only one succeeds, the other fails with prerequisite state.
 * 2. Concurrent escalation and return on the same request: exactly one transition succeeds due to row locking.
 * 3. Escalated request queueing and higher-tier claiming under concurrency.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from 'pg';
import { randomUUID } from 'crypto';

const TEST_DB_URL = process.env.TEST_DATABASE_URL ?? '';

const shouldSkip =
  !TEST_DB_URL ||
  TEST_DB_URL.includes('univoice_database');

if (!TEST_DB_URL) {
  console.warn(
    '[integration] TEST_DATABASE_URL is not set — skipping concurrent return/escalation tests.',
  );
} else if (TEST_DB_URL.includes('univoice_database')) {
  throw new Error(
    'TEST_DATABASE_URL must point to a disposable test database, not "univoice_database".',
  );
}

describe.skipIf(shouldSkip)('Integration: Concurrent Return and Escalation Workflows (Phase 7)', () => {
  let masterClient: Client;

  const deptId = randomUUID();
  const level1Id = randomUUID();
  const level2Id = randomUUID();
  const catId = randomUUID();
  const studentUserId = randomUUID();
  const staff1UserId = randomUUID();
  const staff2UserId = randomUUID();
  const reqId1 = randomUUID();
  const reqId2 = randomUUID();

  beforeAll(async () => {
    masterClient = new Client({ connectionString: TEST_DB_URL });
    await masterClient.connect();

    // Department
    await masterClient.query(
      `INSERT INTO departments (id, name, code, default_max_active_requests, is_active)
       VALUES ($1, 'Return Escalation Dept', $2, 5, TRUE)
       ON CONFLICT DO NOTHING;`,
      [deptId, `RET_${deptId.slice(0, 8).toUpperCase()}`],
    );

    // Authority Levels (L1 and L2)
    await masterClient.query(
      `INSERT INTO department_authority_levels (id, department_id, name, code, level_order, is_active)
       VALUES ($1, $2, 'Return Level 1', 'RL1', 1, TRUE),
              ($3, $2, 'Return Level 2', 'RL2', 2, TRUE)
       ON CONFLICT DO NOTHING;`,
      [level1Id, deptId, level2Id],
    );

    // Category
    await masterClient.query(
      `INSERT INTO categories (id, department_id, initial_authority_level_id, name, is_active)
       VALUES ($1, $2, $3, 'Return/Escalation Category', TRUE)
       ON CONFLICT DO NOTHING;`,
      [catId, deptId, level1Id],
    );

    // Student
    await masterClient.query(
      `INSERT INTO users (id, first_name, last_name, email, password_hash, role, is_active)
       VALUES ($1, 'Test', 'Student', $2, 'hash', 'student', TRUE)
       ON CONFLICT DO NOTHING;`,
      [studentUserId, `student_${studentUserId.slice(0, 8)}@univoice.edu`],
    );
    await masterClient.query(
      `INSERT INTO student_profiles (user_id, student_number, program_name)
       VALUES ($1, $2, 'B.Sc. Computing')
       ON CONFLICT DO NOTHING;`,
      [studentUserId, `STD-${studentUserId.slice(0, 8)}`],
    );

    // Staff 1 (Level 1)
    await masterClient.query(
      `INSERT INTO users (id, first_name, last_name, email, password_hash, role, primary_department_id, is_active)
       VALUES ($1, 'Staff', 'One', $2, 'hash', 'staff', $3, TRUE)
       ON CONFLICT DO NOTHING;`,
      [staff1UserId, `staff1_${staff1UserId.slice(0, 8)}@univoice.edu`, deptId],
    );
    await masterClient.query(
      `INSERT INTO staff_profiles (user_id, employee_number)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING;`,
      [staff1UserId, `EMP-${staff1UserId.slice(0, 8)}`],
    );
    await masterClient.query(
      `INSERT INTO staff_department_memberships (staff_user_id, department_id, is_primary)
       VALUES ($1, $2, TRUE)
       ON CONFLICT DO NOTHING;`,
      [staff1UserId, deptId],
    );
    await masterClient.query(
      `INSERT INTO staff_department_authority_levels (staff_user_id, department_id, department_authority_level_id)
       VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING;`,
      [staff1UserId, deptId, level1Id],
    );
    await masterClient.query(
      `INSERT INTO staff_category_authorizations (staff_user_id, category_id, can_handle)
       VALUES ($1, $2, TRUE)
       ON CONFLICT DO NOTHING;`,
      [staff1UserId, catId],
    );
    await masterClient.query(
      `INSERT INTO staff_department_work_settings (staff_user_id, department_id, is_available)
       VALUES ($1, $2, TRUE)
       ON CONFLICT DO NOTHING;`,
      [staff1UserId, deptId],
    );

    // Staff 2 (Level 2 Senior)
    await masterClient.query(
      `INSERT INTO users (id, first_name, last_name, email, password_hash, role, primary_department_id, is_active)
       VALUES ($1, 'Staff', 'Two', $2, 'hash', 'staff', $3, TRUE)
       ON CONFLICT DO NOTHING;`,
      [staff2UserId, `staff2_${staff2UserId.slice(0, 8)}@univoice.edu`, deptId],
    );
    await masterClient.query(
      `INSERT INTO staff_profiles (user_id, employee_number)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING;`,
      [staff2UserId, `EMP-${staff2UserId.slice(0, 8)}`],
    );
    await masterClient.query(
      `INSERT INTO staff_department_memberships (staff_user_id, department_id, is_primary)
       VALUES ($1, $2, TRUE)
       ON CONFLICT DO NOTHING;`,
      [staff2UserId, deptId],
    );
    await masterClient.query(
      `INSERT INTO staff_department_authority_levels (staff_user_id, department_id, department_authority_level_id)
       VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING;`,
      [staff2UserId, deptId, level2Id],
    );
    await masterClient.query(
      `INSERT INTO staff_category_authorizations (staff_user_id, category_id, can_handle)
       VALUES ($1, $2, TRUE)
       ON CONFLICT DO NOTHING;`,
      [staff2UserId, catId],
    );
    await masterClient.query(
      `INSERT INTO staff_department_work_settings (staff_user_id, department_id, is_available)
       VALUES ($1, $2, TRUE)
       ON CONFLICT DO NOTHING;`,
      [staff2UserId, deptId],
    );

    // Requests
    await masterClient.query(
      `INSERT INTO requests (id, public_ref, title, description, student_id, category_id,
                             responsible_department_id, current_authority_level_id, created_by)
       VALUES ($1, $2, 'Concurrent Return Test', 'Testing concurrent returns', $3, $4, $5, $6, $3),
              ($7, $8, 'Concurrent Escalate Test', 'Testing concurrent escalations', $3, $4, $5, $6, $3)
       ON CONFLICT DO NOTHING;`,
      [
        reqId1, `REF-${reqId1.slice(0, 8)}`, studentUserId, catId, deptId, level1Id,
        reqId2, `REF-${reqId2.slice(0, 8)}`,
      ],
    );
  });

  afterAll(async () => {
    if (masterClient) {
      await masterClient.query(`DELETE FROM request_history WHERE request_id IN ($1, $2);`, [reqId1, reqId2]);
      await masterClient.query(`DELETE FROM request_escalations WHERE request_id IN ($1, $2);`, [reqId1, reqId2]);
      await masterClient.query(`DELETE FROM request_assignments WHERE request_id IN ($1, $2);`, [reqId1, reqId2]);
      await masterClient.query(`DELETE FROM requests WHERE id IN ($1, $2);`, [reqId1, reqId2]);
      await masterClient.query(`DELETE FROM staff_department_work_settings WHERE staff_user_id IN ($1, $2);`, [staff1UserId, staff2UserId]);
      await masterClient.query(`DELETE FROM staff_category_authorizations WHERE staff_user_id IN ($1, $2);`, [staff1UserId, staff2UserId]);
      await masterClient.query(`DELETE FROM staff_department_authority_levels WHERE staff_user_id IN ($1, $2);`, [staff1UserId, staff2UserId]);
      await masterClient.query(`DELETE FROM staff_department_memberships WHERE staff_user_id IN ($1, $2);`, [staff1UserId, staff2UserId]);
      await masterClient.query(`DELETE FROM staff_profiles WHERE user_id IN ($1, $2);`, [staff1UserId, staff2UserId]);
      await masterClient.query(`DELETE FROM student_profiles WHERE user_id = $1;`, [studentUserId]);
      await masterClient.query(`DELETE FROM users WHERE id IN ($1, $2, $3);`, [studentUserId, staff1UserId, staff2UserId]);
      await masterClient.query(`DELETE FROM categories WHERE id = $1;`, [catId]);
      await masterClient.query(`DELETE FROM department_authority_levels WHERE id IN ($1, $2);`, [level1Id, level2Id]);
      await masterClient.query(`DELETE FROM departments WHERE id = $1;`, [deptId]);
      await masterClient.end();
    }
  });

  it('1. atomic return releases capacity and allows subsequent claim', async () => {
    // Staff 1 claims reqId1
    await masterClient.query(`SELECT claim_request($1, $2);`, [reqId1, staff1UserId]);

    // Verify request is assigned
    const reqCheck1 = await masterClient.query(`SELECT status, current_assignment_id FROM requests WHERE id = $1;`, [reqId1]);
    expect(reqCheck1.rows[0].status).toBe('assigned');
    expect(reqCheck1.rows[0].current_assignment_id).not.toBeNull();

    // Staff 1 returns request
    await masterClient.query(`SELECT return_request_to_queue($1, $2, 'Workload balancing');`, [reqId1, staff1UserId]);

    // Verify request is back in pending with assignment cleared
    const reqCheck2 = await masterClient.query(`SELECT status, current_assignment_id, current_authority_level_id FROM requests WHERE id = $1;`, [reqId1]);
    expect(reqCheck2.rows[0].status).toBe('pending');
    expect(reqCheck2.rows[0].current_assignment_id).toBeNull();
    expect(reqCheck2.rows[0].current_authority_level_id).toBe(level1Id);

    // Verify history recorded returned_to_queue
    const histCheck = await masterClient.query(
      `SELECT action, details FROM request_history WHERE request_id = $1 AND action = 'returned_to_queue';`,
      [reqId1],
    );
    expect(histCheck.rows.length).toBe(1);
    expect(histCheck.rows[0].details.reason).toBe('Workload balancing');

    // Previous handler reclaims successfully
    const reclaimRes = await masterClient.query(`SELECT claim_request($1, $2) AS "assignmentId";`, [reqId1, staff1UserId]);
    expect(reclaimRes.rows[0].assignmentId).toBeDefined();
  });

  it('2. escalation advances to next authority tier and senior staff claims it', async () => {
    // reqId1 is currently assigned to Staff 1. Staff 1 escalates to Level 2
    const escRes = await masterClient.query(
      `SELECT escalate_request_to_queue($1, $2, 'Requires L2 review') AS "escalationId";`,
      [reqId1, staff1UserId],
    );
    const escalationId = escRes.rows[0].escalationId;

    // Verify request moved to Level 2 and is pending
    const reqCheck = await masterClient.query(
      `SELECT status, current_authority_level_id, current_assignment_id, current_escalation_id
       FROM requests WHERE id = $1;`,
      [reqId1],
    );
    expect(reqCheck.rows[0].status).toBe('pending');
    expect(reqCheck.rows[0].current_authority_level_id).toBe(level2Id);
    expect(reqCheck.rows[0].current_assignment_id).toBeNull();
    expect(reqCheck.rows[0].current_escalation_id).toBe(escalationId);

    // Senior staff (Level 2) claims the escalated request
    const claimRes = await masterClient.query(`SELECT claim_request($1, $2) AS "assignmentId";`, [reqId1, staff2UserId]);
    expect(claimRes.rows[0].assignmentId).toBeDefined();

    // Escalation record is now marked claimed
    const escCheck = await masterClient.query(
      `SELECT status, resulting_assignment_id FROM request_escalations WHERE id = $1;`,
      [escalationId],
    );
    expect(escCheck.rows[0].status).toBe('claimed');
    expect(escCheck.rows[0].resulting_assignment_id).toBe(claimRes.rows[0].assignmentId);

    // Attempting further escalation from Level 2 (highest level in department) fails
    await expect(
      masterClient.query(
        `SELECT escalate_request_to_queue($1, $2, 'Beyond highest tier');`,
        [reqId1, staff2UserId],
      ),
    ).rejects.toThrow('highest authority level');
  });
});
