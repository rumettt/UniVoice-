import { describe, it, expect, vi } from 'vitest';
import express, { Request, Response } from 'express';
import request from 'supertest';

vi.mock('../../src/config/env', () => ({
  env: {
    NODE_ENV: 'test',
  },
}));

import {
  requireAuth,
  requireRole,
  requireAdmin,
} from '../../src/middlewares/authorize';
import { errorHandler } from '../../src/middlewares/errorHandler';
import { AuthUser } from '../../src/types/auth';

describe('Authorization Middleware (RBAC & Boundaries)', () => {
  function createTestAppWithUser(user?: AuthUser) {
    const app = express();
    app.use(express.json());

    // Middleware simulating authentication context
    app.use((req, _res, next) => {
      if (user) {
        req.user = user;
      }
      next();
    });

    // Test routes
    app.get('/protected', requireAuth, (_req: Request, res: Response) => {
      res.json({ message: 'authenticated' });
    });

    app.get(
      '/admin-only',
      requireAdmin,
      (_req: Request, res: Response) => {
        res.json({ message: 'admin access granted' });
      },
    );

    app.get(
      '/staff-or-admin',
      requireRole('staff', 'admin'),
      (_req: Request, res: Response) => {
        res.json({ message: 'staff or admin granted' });
      },
    );

    app.use(errorHandler);
    return app;
  }

  it('requireAuth rejects unauthenticated requests with 401', async () => {
    const app = createTestAppWithUser(undefined);
    const res = await request(app).get('/protected');

    expect(res.status).toBe(401);
    expect(res.body.message).toContain('Authentication required');
  });

  it('requireAuth allows authenticated user through', async () => {
    const app = createTestAppWithUser({
      id: 'user-1',
      firstName: 'Sam',
      lastName: 'Student',
      fullName: 'Sam Student',
      email: 'student@univoice.edu',
      role: 'student',
      primaryDepartmentId: null,
    });

    const res = await request(app).get('/protected');
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('authenticated');
  });

  it('requireAdmin forbids student users with 403', async () => {
    const app = createTestAppWithUser({
      id: 'student-id',
      firstName: 'Sam',
      lastName: 'Student',
      fullName: 'Sam Student',
      email: 'student@univoice.edu',
      role: 'student',
      primaryDepartmentId: null,
    });

    const res = await request(app).get('/admin-only');
    expect(res.status).toBe(403);
    expect(res.body.message).toContain(
      'Access forbidden: insufficient role permissions',
    );
  });

  it('requireAdmin forbids staff users with 403', async () => {
    const app = createTestAppWithUser({
      id: 'staff-id',
      firstName: 'Jane',
      lastName: 'Staff',
      fullName: 'Jane Staff',
      email: 'staff@univoice.edu',
      role: 'staff',
      primaryDepartmentId: 'dept-1',
    });

    const res = await request(app).get('/admin-only');
    expect(res.status).toBe(403);
    expect(res.body.message).toContain(
      'Access forbidden: insufficient role permissions',
    );
  });

  it('requireAdmin allows admin users with 200', async () => {
    const app = createTestAppWithUser({
      id: 'admin-id',
      firstName: 'Admin',
      lastName: 'User',
      fullName: 'Admin User',
      email: 'admin@univoice.edu',
      role: 'admin',
      primaryDepartmentId: 'dept-admin',
    });

    const res = await request(app).get('/admin-only');
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('admin access granted');
  });

  it('requireRole allows staff for staff-or-admin route', async () => {
    const app = createTestAppWithUser({
      id: 'staff-id',
      firstName: 'Jane',
      lastName: 'Staff',
      fullName: 'Jane Staff',
      email: 'staff@univoice.edu',
      role: 'staff',
      primaryDepartmentId: 'dept-1',
    });

    const res = await request(app).get('/staff-or-admin');
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('staff or admin granted');
  });
});
