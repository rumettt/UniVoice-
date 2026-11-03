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
│   ├── app.ts                  # Express application factory
│   ├── server.ts               # HTTP server startup and graceful shutdown
│   ├── config/
│   │   ├── env.ts              # Zod-validated environment variables
│   │   └── db.ts               # PostgreSQL connection pool
│   ├── middlewares/
│   │   ├── requestLogger.ts    # HTTP access logging (no sensitive data)
│   │   └── errorHandler.ts     # 404 handler and centralized error handler
│   ├── routes/
│   │   ├── index.ts            # Root router — mounts /api/v1
│   │   └── v1/
│   │       ├── index.ts        # v1 router
│   │       └── health.router.ts# GET /api/v1/health
│   └── utils/
│       ├── AppError.ts         # Typed operational error class
│       └── asyncHandler.ts     # Async route wrapper
├── tests/
│   ├── schema_validation_test.sql  # SQL schema validation suite (database only)
│   └── unit/                   # TypeScript unit/integration tests
│       ├── health.test.ts
│       ├── notFound.test.ts
│       └── errorHandler.test.ts
├── .env.example                # Required environment variable template
├── package.json
├── tsconfig.json
└── vitest.config.ts
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

DB_HOST=localhost
DB_PORT=5432
DB_NAME=univoice_database
DB_USER=your_db_user
DB_PASSWORD=your_db_password
DB_POOL_MAX=10
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

### `GET /api/v1/health`

Returns API availability and database connectivity status.

**Response — healthy:**

```json
{
  "status": "ok",
  "timestamp": "2026-11-03T05:21:27.000Z",
  "database": { "status": "ok" }
}
```

**Response — database unreachable (HTTP 503):**

```json
{
  "status": "degraded",
  "timestamp": "2026-11-03T05:21:27.000Z",
  "database": { "status": "error", "message": "Cannot reach database" }
}
```

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
