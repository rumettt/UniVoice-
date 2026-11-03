import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../src/app';

// Mock the db module so tests never touch a real database.
vi.mock('../../src/config/db', () => ({
  pool: {},
  checkDb: vi.fn(),
  closePool: vi.fn(),
}));

// Mock env so tests don't require a .env file.
vi.mock('../../src/config/env', () => ({
  env: {
    NODE_ENV: 'test',
    PORT: 3000,
    DB_HOST: 'localhost',
    DB_PORT: 5432,
    DB_NAME: 'univoice_database',
    DB_USER: 'test',
    DB_PASSWORD: 'test',
    DB_POOL_MAX: 10,
  },
}));

import { checkDb } from '../../src/config/db';

const mockCheckDb = vi.mocked(checkDb);

describe('GET /api/v1/health', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 200 with status ok when database is reachable', async () => {
    mockCheckDb.mockResolvedValue(true);

    const res = await request(app).get('/api/v1/health');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: 'ok',
      database: { status: 'ok' },
    });
    expect(typeof res.body.timestamp).toBe('string');
  });

  it('returns 503 with status degraded when database is unreachable', async () => {
    mockCheckDb.mockResolvedValue(false);

    const res = await request(app).get('/api/v1/health');

    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({
      status: 'degraded',
      database: {
        status: 'error',
        message: 'Cannot reach database',
      },
    });
  });

  it('does not expose database credentials or connection strings', async () => {
    mockCheckDb.mockResolvedValue(false);

    const res = await request(app).get('/api/v1/health');
    const body = JSON.stringify(res.body);

    expect(body).not.toContain('password');
    expect(body).not.toContain('localhost');
    expect(body).not.toContain('5432');
  });
});
