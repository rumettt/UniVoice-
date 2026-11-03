import { Router } from 'express';
import { checkDb } from '../../config/db';
import { asyncHandler } from '../../utils/asyncHandler';

const router = Router();

router.get(
  '/health',
  asyncHandler(async (_req, res) => {
    const dbOk = await checkDb();

    const payload = {
      status: dbOk ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      database: dbOk
        ? { status: 'ok' }
        : { status: 'error', message: 'Cannot reach database' },
    };

    res.status(dbOk ? 200 : 503).json(payload);
  }),
);

export default router;
