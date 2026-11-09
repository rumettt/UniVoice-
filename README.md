# UniVoice

UniVoice is a university Request Management System. Students submit requests without navigating complex institutional hierarchies; the platform routes them through department authority queues and tracks them to resolution.

---

## Project Structure

```
UniVoice/
├── database/                   # PostgreSQL schema, migrations, and docs
│   ├── schema/                 # Ordered SQL schema files (00–17)
│   ├── migrations/             # Versioned migration scripts
│   ├── DESIGN.md               # Architecture and design decisions
│   ├── README.md               # Schema setup and run instructions
│   └── univoice_schema.sql     # psql entry point for greenfield setup
├── src/                        # TypeScript backend source
│   ├── app.ts                  # Express application factory with cookie parsing
│   ├── server.ts               # HTTP server startup and graceful shutdown
│   ├── config/
│   │   ├── env.ts              # Zod-validated environment variables
│   │   └── db.ts               # PostgreSQL connection pool
│   ├── controllers/
│   │   ├── auth.controller.ts  # Login, refresh, logout, and /me handlers
│   │   ├── user.controller.ts  # User management endpoints
│   │   ├── department.controller.ts # Department CRUD and status
│   │   ├── staffSettings.controller.ts # Memberships & work settings
│   │   ├── authority.controller.ts # Authority hierarchy & assignments
│   │   └── category.controller.ts # Category routing configuration
│   ├── middlewares/
│   │   ├── authenticate.ts     # Bearer JWT verification & active user loader
│   │   ├── authorize.ts        # Role-based access control (RBAC) & boundaries
│   │   ├── requestLogger.ts    # HTTP access logging (no sensitive data)
│   │   └── errorHandler.ts     # 404 handler and centralized error handler
│   ├── repositories/
│   │   ├── user.repository.ts  # User and profile transactional queries
│   │   ├── refreshToken.repository.ts # Atomic token rotation & replay detection
│   │   ├── department.repository.ts # Department queries and derived metrics
│   │   ├── staff.repository.ts # Effective-dated memberships & work settings
│   │   ├── authority.repository.ts # Authority hierarchy & collision-free reorder
│   │   ├── category.repository.ts # Category configuration & routing targets
│   │   └── request.repository.ts  # Student requests & routing
│   ├── routes/
│   │   ├── index.ts            # Root router — mounts /api/v1
│   │   └── v1/
│   │       ├── index.ts        # v1 router
│   │       ├── health.router.ts# GET /api/v1/health
│   │       ├── auth.router.ts  # /api/v1/auth/* endpoints
│   │       ├── user.router.ts  # /api/v1/users/* endpoints
│   │       ├── department.router.ts # /api/v1/departments/* endpoints
│   │       ├── category.router.ts # /api/v1/categories/* endpoints
│   │       └── request.router.ts  # /api/v1/requests/* endpoints
│   ├── services/
│   │   ├── admin/
│   │   │   ├── userManagement.service.ts # Transactional user provisioning
│   │   │   ├── department.service.ts     # Department lifecycle & metrics
│   │   │   ├── staffSettings.service.ts  # Staff appointments & work settings
│   │   │   ├── authority.service.ts      # Authority tiers & reordering
│   │   │   └── category.service.ts       # Category routing validation
│   │   ├── auth/
│   │   │   ├── password.service.ts # Argon2id password hashing and verification
│   │   │   └── token.service.ts    # JWT access tokens & refresh token hashing
│   │   └── student/
│   │       └── request.service.ts  # Request submission & student workflow service
│   ├── types/
│   │   ├── auth.ts             # Auth types (AuthUser, JwtPayload, UserRole)
│   │   └── express.d.ts        # Express Request augmentation for req.user
│   ├── utils/
│   │   ├── AppError.ts         # Typed operational error class
│   │   └── asyncHandler.ts     # Async route wrapper
│   └── validators/
│       ├── auth.validators.ts  # Login payload validation
│       ├── user.validators.ts  # User management validation
│       ├── department.validators.ts # Department validation
│       ├── staff.validators.ts # Staff membership & settings validation
│       ├── authority.validators.ts # Authority levels & assignments validation
│       ├── category.validators.ts # Category validation
│       └── request.validators.ts # Student request validation
├── tests/
│   ├── schema_validation_test.sql  # SQL schema validation suite (database only)
│   └── unit/                   # TypeScript unit/integration tests
│       ├── auth.test.ts        # Full auth lifecycle & security tests
│       ├── authorization.test.ts # Role-based access control & boundaries tests
│       ├── errorHandler.test.ts# Centralized error handler tests
│       ├── health.test.ts      # Health check tests
│       ├── notFound.test.ts    # 404 handler tests
│       ├── refreshToken.repository.test.ts # Concurrency & atomic lock tests
│       ├── userManagement.test.ts # User creation, profiles & status tests
│       ├── department.test.ts  # Department CRUD & metrics tests
│       ├── staffMembership.test.ts # Multi-department & appointment tests
│       ├── authority.test.ts   # Hierarchy, reordering & cross-dept checks
│       ├── staffSettings.test.ts # Work settings & capacity tests
│       ├── category.test.ts    # Category routing & active filters tests
│       └── request.test.ts     # Request submission, routing & student workflow tests
├── .env.example                # Required environment variable template
├── package.json
├── PROGRESS.md                 # Project phase & milestone tracker
├── tsconfig.json
└── vitest.config.mjs
```

---

## Backend Setup

### Prerequisites

| Requirement | Version |
|---|---|
| Node.js | ≥ 20 |
| npm | ≥ 9 |
| PostgreSQL | 15+ recommended |

### 1. Install dependencies

```powershell
npm install
```

### 2. Configure environment variables

Copy `.env.example` to `.env` and fill in your values:

```powershell
Copy-Item .env.example .env
```

Then edit `.env`:

```env
NODE_ENV=development
PORT=3000

# PostgreSQL
DB_HOST=localhost
DB_PORT=5432
DB_NAME=univoice_database
DB_USER=postgres
DB_PASSWORD=your_password
DB_POOL_MAX=10

# Security & JWT Secrets
JWT_ACCESS_SECRET=your_super_secret_access_key_min_32_characters!
JWT_REFRESH_SECRET=your_super_secret_refresh_key_min_32_characters!
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d
COOKIE_SECURE=false
```

> **Never commit `.env` to version control.**

### 3. Create the database

Create the `univoice_database` database in PostgreSQL, then apply the schema:

```powershell
psql -v ON_ERROR_STOP=1 -d univoice_database -f database/univoice_schema.sql
```

See [`database/README.md`](database/README.md) for full schema setup instructions.

---

## Running the API

### Development (with live reload)

```powershell
npm run dev
```

### Production

```powershell
npm run build
npm start
```

---

## API Endpoints

### Health Check

#### `GET /api/v1/health`
Returns API availability and database connectivity status.

---

### Authentication (`/api/v1/auth`)

- `POST /api/v1/auth/login`: Authenticate credentials, issue access token and HttpOnly refresh token cookie.
- `POST /api/v1/auth/refresh`: Atomic refresh token rotation with replay detection and family revocation.
- `POST /api/v1/auth/logout`: Revoke active refresh token and clear cookie.
- `GET /api/v1/auth/me`: Safe profile for current authenticated user.

---

### User Management (`/api/v1/users`) — Admin Only

- `POST /api/v1/users`: Create student, staff, or admin user inside an atomic database transaction.
  - Student: requires `studentNumber`; creates linked `student_profiles` row.
  - Staff: requires `employeeNumber` and valid `primaryDepartmentId`; provisions `staff_profiles`, initial `staff_department_memberships`, and initial `staff_department_work_settings`.
- `GET /api/v1/users`: Paginated listing with filtering (`role`, `departmentId`, `isActive`, `search`).
- `GET /api/v1/users/:id`: Single user details with profile records and home department.
- `PATCH /api/v1/users/:id/profile`: Update user profile details.
- `PATCH /api/v1/users/:id/status`: Activate or deactivate account (revokes refresh tokens upon deactivation).
- `GET /api/v1/users/:staffUserId/departments`: Inspect department appointments for a staff member.
- `GET /api/v1/users/:staffUserId/authority-assignments`: Inspect authority tiers assigned across departments.

---

### Department Management (`/api/v1/departments`)

- `POST /api/v1/departments`: Create department with unique code and positive default max active requests *(Admin only)*.
- `GET /api/v1/departments`: List departments with pagination.
- `GET /api/v1/departments/:id`: Retrieve department details with dynamically derived metrics (`activeAuthorityLevelsCount`, `activeStaffCount`, `activeCategoriesCount`).
- `PATCH /api/v1/departments/:id`: Update department details *(Admin only)*.
- `PATCH /api/v1/departments/:id/status`: Activate or deactivate department *(Admin only)*.

---

### Staff Department Appointments & Settings

- `POST /api/v1/departments/:departmentId/staff`: Assign staff member to department with effective-dating *(Admin only)*.
- `GET /api/v1/departments/:departmentId/staff`: List staff members belonging to department.
- `DELETE /api/v1/departments/:departmentId/staff/:staffUserId`: End active department appointment *(Admin only)*.
- `GET /api/v1/departments/:departmentId/staff/:staffUserId/work-settings`: Retrieve availability and capacity (resolves individual override vs department default).
- `PATCH /api/v1/departments/:departmentId/staff/:staffUserId/work-settings`: Update availability and capacity limit override *(Admin only)*.

---

### Department Authority Hierarchy

- `POST /api/v1/departments/:departmentId/authority-levels`: Create authority level with monotonic `levelOrder` *(Admin only)*.
- `GET /api/v1/departments/:departmentId/authority-levels`: List authority levels ordered by `level_order ASC`.
- `PUT /api/v1/departments/:departmentId/authority-levels/reorder`: Safely reorder authority levels without intermediate unique constraint collisions *(Admin only)*.
- `PATCH /api/v1/departments/:departmentId/authority-levels/:id`: Update authority level name, description, or status *(Admin only)*.
- `POST /api/v1/departments/:departmentId/authority-levels/assignments`: Assign staff to department authority tier *(Admin only)*.
- `DELETE /api/v1/departments/:departmentId/authority-levels/assignments/:staffUserId`: End active authority assignment *(Admin only)*.

---

### Category Routing (`/api/v1/categories`)

- `POST /api/v1/categories`: Create request category associated with department and initial authority queue *(Admin only)*.
- `GET /api/v1/categories`: List categories (automatically filtered to active categories for non-admins).
- `GET /api/v1/categories/:id`: Retrieve single category details.
- `PATCH /api/v1/categories/:id`: Update category routing target and defaults *(Admin only)*.
- `PATCH /api/v1/categories/:id/status`: Activate or deactivate category *(Admin only)*.

---

### Student Request Submission & Tracking (`/api/v1/requests`)

- `POST /api/v1/requests`: Submit a new request with category selection, title, and description *(Student only)*.
  - Automatically derives responsible department and initial authority queue from database category configuration.
  - Generates unique reference number (`REQ-YYYY-XXXXX`).
  - Begins in `pending` status in the department queue with initial history entry recorded.
- `GET /api/v1/requests/me`: Retrieve paginated requests submitted by the authenticated student *(Student only)*.
  - Supports SQL-level filtering by `status` and `categoryId`.
  - Max limit: 100 requests per page.
- `GET /api/v1/requests/:requestId`: Retrieve details of an individual request *(Student only)*.
  - Restricted to requests submitted by the authenticated student.
  - Returns 404 for nonexistent requests or requests belonging to other students to avoid information leakage.

---

## Authorization Boundaries

UniVoice maintains strict architectural separation:
1. **Authentication (`authenticate`)**: Establishes *who* the user is, validating cryptographic signatures and loading trusted role/active status from the database.
2. **Core Authorization (`requireRole`, `requireAdmin`)**: Enforces coarse-grained role checks (`student`, `staff`, `admin`) at route boundaries.
3. **Workflow & Resource Authorization**: Fine-grained department queue eligibility, authority levels, and request ownership (ensuring students access only their own requests) are decoupled from coarse RBAC and checked within domain logic.

---

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start development server with live reload |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run the compiled production server |
| `npm run typecheck` | Type-check without emitting files |
| `npm test` | Run all tests (no database required) |
| `npm run test:watch` | Run tests in watch mode |
| `npm run test:coverage`| Run test coverage report |

---

## Testing

Tests are located in `tests/unit/`. They mock the database pool and do **not** require a running PostgreSQL instance.

```powershell
npm test
```

---

## Database Documentation

- Schema design and architectural decisions: [`database/DESIGN.md`](database/DESIGN.md)
- Schema setup and migration instructions: [`database/README.md`](database/README.md)
