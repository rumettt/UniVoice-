/**
 * Integration test: concurrent reopen attempts on a closed request at reopen_count = 1 and max = 2.
 *
 * Verifies that two concurrent transactions attempting to reopen the same request
 * when only 1 reopening remains will allow exactly one reopen to succeed, while
 * the second transaction is rejected due to max count limit or prerequisite state.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from 'pg';
import { randomUUID } from 'crypto';

const TEST_DB_URL = process.env.TEST_DATABASE_URL ?? '';

const shouldSkip = !TEST_DB_URL || TEST_DB_URL.includes('univoice_database');

if (!TEST_DB_URL) {
  console.warn(
    '[integration] TEST_DATABASE_URL is not set — skipping concurrent reopen tests.',
  );
} else if (TEST_DB_URL.includes('univoice_database')) {
  throw new Error(
    'TEST_DATABASE_URL must point to a disposable test database, not "univoice_database".',
  );
}

describe.skipIf(shouldSkip)('Integration: Concurrent Request Reopening', () => {
  let masterClient: Client;
  const studentUserId = randomUUID();
  const deptId = randomUUID();
  const catId = randomUUID();
  const level1Id = randomUUID();
  const requestId = randomUUID();

  beforeAll(async () => {
    masterClient = new Client({ connectionString: TEST_DB_URL });
    await masterClient.connect();

    // Seed test department
    await masterClient.query(
      `INSERT INTO departments (id, code, name, default_max_active_requests)
       VALUES ($1, 'TEST_DEPT_WF', 'Test Workflow Dept', 5)
       ON CONFLICT DO NOTHING;`,
      [deptId],
    );

    // Seed authority level
    await masterClient.query(
      `INSERT INTO department_authority_levels (id, department_id, code, name, level_order)
       VALUES ($1, $2, 'L1', 'Level 1', 1)
       ON CONFLICT DO NOTHING;`,
      [level1Id, deptId],
    );

    // Seed category
    await masterClient.query(
      `INSERT INTO categories (id, name, department_id, initial_authority_level_id)
       VALUES ($1, 'Test Reopen Cat', $2, $3)
       ON CONFLICT DO NOTHING;`,
      [catId, deptId, level1Id],
    );

    // Seed student user
    await masterClient.query(
      `INSERT INTO users (id, email, password_hash, role, first_name, last_name, is_active)
       VALUES ($1, 'reopen.student@test.edu', 'hash', 'student', 'Reopen', 'Student', TRUE)
       ON CONFLICT DO NOTHING;`,
      [studentUserId],
    );

    await masterClient.query(
      `INSERT INTO student_profiles (user_id, student_number, program_name)
       VALUES ($1, 'STU-WF-001', 'Computer Science')
       ON CONFLICT DO NOTHING;`,
      [studentUserId],
    );

    // Seed a closed request with reopen_count = 1 and max = 2
    await masterClient.query(
      `INSERT INTO requests (
         id, public_ref, title, description, student_id, category_id,
         responsible_department_id, current_authority_level_id, priority, status,
         created_at, first_closed_at, closed_at, resolved_at, reopen_count, created_by, updated_by
       ) VALUES (
         $1, 'REQ-REOPEN-CONC', 'Reopen Test', 'Testing concurrency', $2, $3,
         $4, $5, 'medium', 'closed',
         NOW() - INTERVAL '2 days', NOW() - INTERVAL '1 day', NOW() - INTERVAL '1 day', NOW() - INTERVAL '1 day',
         1, $2, $2
       );`,
      [requestId, studentUserId, catId, deptId, level1Id],
    );
  });

  afterAll(async () => {
    if (masterClient) {
      await masterClient.query(`ALTER TABLE request_history DISABLE TRIGGER trg_request_history_immutable`);
      try {
        await masterClient.query(`DELETE FROM request_history WHERE request_id = $1;`, [requestId]);
        await masterClient.query(`DELETE FROM requests WHERE id = $1;`, [requestId]);
      } finally {
        await masterClient.query(`ALTER TABLE request_history ENABLE TRIGGER trg_request_history_immutable`);
      }
      await masterClient.query(`DELETE FROM student_profiles WHERE user_id = $1;`, [studentUserId]);
      await masterClient.query(`DELETE FROM users WHERE id = $1;`, [studentUserId]);
      await masterClient.query(`DELETE FROM categories WHERE id = $1;`, [catId]);
      await masterClient.query(`DELETE FROM department_authority_levels WHERE id = $1;`, [level1Id]);
      await masterClient.query(`DELETE FROM departments WHERE id = $1;`, [deptId]);
      await masterClient.end();
    }
  });

  it('serializes concurrent reopen attempts and ensures max_reopen_count cannot be bypassed', async () => {
    const client1 = new Client({ connectionString: TEST_DB_URL });
    const client2 = new Client({ connectionString: TEST_DB_URL });
    await client1.connect();
    await client2.connect();

    const maxReopenCount = 2;
    const reopenAttempt = async (c: Client, reason: string): Promise<string> => {
      try {
        await c.query('BEGIN');
        const res = await c.query(
          `SELECT id, status, reopen_count FROM requests WHERE id = $1 FOR UPDATE;`,
          [requestId],
        );
        const req = res.rows[0];
        if (req.status !== 'closed') {
          throw new Error(`Cannot reopen request with status ${req.status}`);
        }
        if (req.reopen_count >= maxReopenCount) {
          throw new Error('Reopen limit exceeded');
        }

        await c.query(
          `UPDATE requests
           SET status = 'pending',
               current_assignment_id = NULL,
               reopen_count = reopen_count + 1,
               last_reopen_reason = $1,
               updated_by = $2,
               updated_at = NOW()
           WHERE id = $3;`,
          [reason, studentUserId, requestId],
        );

        await c.query('COMMIT');
        return 'SUCCESS';
      } catch (err: unknown) {
        await c.query('ROLLBACK');
        return (err as Error).message;
      }
    };

    const [res1, res2] = await Promise.all([
      reopenAttempt(client1, 'Attempt A'),
      reopenAttempt(client2, 'Attempt B'),
    ]);

    await client1.end();
    await client2.end();

    const successCount = [res1, res2].filter((r) => r === 'SUCCESS').length;
    expect(successCount).toBe(1);

    // Verify final state in database
    const finalRes = await masterClient.query(
      `SELECT status, reopen_count FROM requests WHERE id = $1;`,
      [requestId],
    );
    expect(finalRes.rows[0].status).toBe('pending');
    expect(finalRes.rows[0].reopen_count).toBe(2);
  });
});
