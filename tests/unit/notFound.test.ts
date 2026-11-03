import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import app from '../../src/app';

vi.mock('../../src/config/db', () => ({
  pool: {},
  checkDb: vi.fn(),
  closePool: vi.fn(),
}));

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

describe('404 — unknown routes', () => {
  it('returns 404 for an unknown GET route', async () => {
    const res = await request(app).get('/api/v1/does-not-exist');

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ status: 'error' });
    expect(res.body.message).toContain('Route not found');
  });

  it('returns 404 for an unknown POST route', async () => {
    const res = await request(app).post('/api/v2/unknown');

    expect(res.status).toBe(404);
    expect(res.body.status).toBe('error');
  });

  it('returns 404 for the root path', async () => {
    const res = await request(app).get('/');

    expect(res.status).toBe(404);
  });
});
