import app from './app';
import { env } from './config/env';
import { closePool } from './config/db';

const server = app.listen(env.PORT, () => {
  console.log(
    `[server] UniVoice API running on port ${env.PORT} (${env.NODE_ENV})`,
  );
});

// ── Graceful shutdown ──────────────────────────────────────────────────────
async function shutdown(signal: string): Promise<void> {
  console.log(`[server] ${signal} received — shutting down gracefully`);

  server.close(async (err) => {
    if (err) {
      console.error('[server] Error closing HTTP server:', err.message);
      process.exit(1);
    }

    try {
      await closePool();
      console.log('[server] Database pool closed');
    } catch (poolErr) {
      console.error('[server] Error closing DB pool:', (poolErr as Error).message);
    }

    console.log('[server] Shutdown complete');
    process.exit(0);
  });
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

export default server;
