export type UserRole = 'student' | 'staff' | 'admin';

export interface AuthUser {
  id: string;
  firstName: string;
  lastName: string;
  fullName: string;
  email: string;
  role: UserRole;
  primaryDepartmentId: string | null;
}

export interface JwtAccessTokenPayload {
  sub: string;
  email: string;
  role: UserRole;
  iat?: number;
  exp?: number;
}
