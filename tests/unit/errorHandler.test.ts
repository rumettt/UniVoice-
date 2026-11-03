import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import express, { Request, Response, NextFunction } from 'express';
import { errorHandler, notFoundHandler } from '../../src/middlewares/errorHandler';
import { AppError } from '../../src/utils/AppError';

vi.mock('../../src/config/env', () => ({
  env: { NODE_ENV: 'test' },
}));

/**
 * Creates a minimal Express app wired with a test route,
 * the notFound handler, and the centralized error handler.
 */
function makeApp(
  route: (req: Request, res: Response, next: NextFunction) => void,
) {
  const testApp = express();
  testApp.use(express.json());
  testApp.get('/test', route);
  testApp.use(notFoundHandler);
  testApp.use(errorHandler);
  return testApp;
}

describe('Centralized error handler', () => {
  it('returns the AppError status code and message for operational errors', async () => {
    const app = makeApp((_req, _res, next) => {
      next(new AppError('Resource not found', 404));
    });

    const res = await request(app).get('/test');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ status: 'error', message: 'Resource not found' });
  });

  it('returns 400 for a 400 AppError', async () => {
    const app = makeApp((_req, _res, next) => {
      next(new AppError('Bad input', 400));
    });

    const res = await request(app).get('/test');

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Bad input');
  });

  it('returns 500 for unknown programming errors and exposes message in non-production', async () => {
    const app = makeApp((_req, _res, next) => {
      next(new Error('Unexpected crash'));
    });

    const res = await request(app).get('/test');

    expect(res.status).toBe(500);
    expect(res.body.status).toBe('error');
    // In test env (not production) the actual message is surfaced
    expect(res.body.message).toBe('Unexpected crash');
  });

  it('returns 500 for non-Error thrown values', async () => {
    const app = makeApp((_req, _res, next) => {
      next('string error');
    });

    const res = await request(app).get('/test');

    expect(res.status).toBe(500);
    expect(res.body.status).toBe('error');
  });
});
