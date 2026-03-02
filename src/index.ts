import 'dotenv/config';
import Fastify from 'fastify';
import { env } from './config/env.js';
import { registerEvolutionWebhook } from './webhooks/evolution.js';

async function main(): Promise<void> {
  const app = Fastify({
    // 🔒 Limit request body to 1MB (webhooks are small JSON)
    bodyLimit: 1_048_576,
    logger: {
      level: env.NODE_ENV === 'production' ? 'info' : 'debug',
      transport:
        env.NODE_ENV === 'development'
          ? {
              target: 'pino-pretty',
              options: {
                colorize: true,
              },
            }
          : undefined,
    },
  });

  // Health check endpoint
  app.get('/health', async () => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });

  // 📊 Daily summary endpoint (called by external cron or internal timer)
  app.post('/cron/daily-summary', async (request, reply) => {
    const apiKey = request.headers['apikey'] as string | undefined;
    if (apiKey !== env.EVOLUTION_API_KEY) {
      return reply.status(401).send({ error: 'unauthorized' });
    }
    const { sendDailySummaries } = await import('./services/daily-summary.js');
    const result = await sendDailySummaries();
    return result;
  });

  // Register Evolution API webhook
  registerEvolutionWebhook(app);

  // ⏰ Internal cron: daily summary at 8:30 AM BRT (11:30 UTC)
  function scheduleDailySummary(): void {
    const now = new Date();
    const target = new Date(now);
    target.setUTCHours(11, 30, 0, 0); // 8:30 AM BRT
    if (target <= now) target.setDate(target.getDate() + 1);
    const delay = target.getTime() - now.getTime();

    console.log(`[Cron] Daily summary scheduled in ${Math.round(delay / 60000)} minutes`);
    setTimeout(async () => {
      try {
        const { sendDailySummaries } = await import('./services/daily-summary.js');
        await sendDailySummaries();
      } catch (err) {
        console.error('[Cron] Daily summary failed:', err);
      }
      // Reschedule for next day
      scheduleDailySummary();
    }, delay);
  }

  scheduleDailySummary();

  // Graceful shutdown
  const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];
  for (const signal of signals) {
    process.on(signal, async () => {
      console.log(`\n[Server] Received ${signal}, shutting down gracefully...`);
      await app.close();
      process.exit(0);
    });
  }

  try {
    await app.listen({ port: env.PORT, host: '0.0.0.0' });
    console.log(`[Server] IDM Portfolio Bot running on port ${env.PORT}`);
    console.log(`[Server] Environment: ${env.NODE_ENV}`);
  } catch (error) {
    console.error('[Server] Failed to start:', error);
    process.exit(1);
  }
}

main();
