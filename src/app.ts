import express from 'express';
import { requestLogger } from './middlewares/requestLogger';
import { notFoundHandler, errorHandler } from './middlewares/errorHandler';
import rootRouter from './routes';

const app = express();

// ── Body parsing ───────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Request logging ────────────────────────────────────────────────────────
app.use(requestLogger);

// ── Routes ─────────────────────────────────────────────────────────────────
app.use(rootRouter);

// ── 404 for unmatched routes ───────────────────────────────────────────────
app.use(notFoundHandler);

// ── Centralized error handler ──────────────────────────────────────────────
app.use(errorHandler);

export default app;
