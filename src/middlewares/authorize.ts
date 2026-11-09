import { Request, Response, NextFunction } from 'express';
import { UserRole } from '../types/auth';
import { AppError } from '../utils/AppError';

/**
 * ============================================================================
 * UniVoice Authorization Boundaries & Architecture:
 * ============================================================================
 * 1. Authentication (`authenticate` middleware):
 *    Establishes WHO the user is. Cryptographically verifies credentials and
 *    attaches trusted user details directly from the database to `req.user`.
 *
 * 2. Core Authorization (`requireAuth`, `requireRole`, `requireAdmin`):
 *    Provides role-based access control (RBAC) at the boundary layer for coarse-grained
 *    system access (student, staff, admin).
 *
 * 3. Workflow-Level & Fine-Grained Authorization (Phase 3+ boundary):
 *    Department membership, department-specific authority levels, queue claiming,
 *    and resource ownership (e.g. students only accessing their own submitted requests)
 *    MUST NOT be conflated with coarse authentication or trusted from client parameters.
 *    They will be enforced by dedicated request workflow services and domain policies.
 * ============================================================================
 */

/**
 * Ensures a request has an authenticated user attached.
 */
export function requireAuth(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  if (!req.user) {
    return next(new AppError('Authentication required', 401));
  }
  next();
}

/**
 * Restricts access to users holding one of the specified system roles.
 */
export function requireRole(...allowedRoles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      return next(new AppError('Authentication required', 401));
    }

    if (!allowedRoles.includes(req.user.role)) {
      return next(
        new AppError(
          'Access forbidden: insufficient role permissions for this resource',
          403,
        ),
      );
    }

    next();
  };
}

/**
 * Convenience authorization middleware for administrative routes.
 */
export const requireAdmin = requireRole('admin');
