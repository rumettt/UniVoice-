import express from 'express';
import cookieParser from 'cookie-parser';
import { requestLogger } from './middlewares/requestLogger';
import { notFoundHandler, errorHandler } from './middlewares/errorHandler';
import rootRouter from './routes';

const app = express();

// ── Body & Cookie parsing ───────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// ── Request logging ────────────────────────────────────────────────────────
app.use(requestLogger);

// ── Routes ─────────────────────────────────────────────────────────────────
app.use(rootRouter);

// ── 404 for unmatched routes ───────────────────────────────────────────────
app.use(notFoundHandler);

// ── Centralized error handler ──────────────────────────────────────────────
app.use(errorHandler);

export default app;
