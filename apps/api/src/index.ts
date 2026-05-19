import { env, validateEnv } from './env.js';
import { buildServer } from './server.js';
import { prepullImages } from './exec/prepull.js';
import { getPool } from './exec/pool.js';

const start = async () => {
  const { errors, warnings } = validateEnv(env);
  for (const w of warnings) {
    console.warn(`[opencoder env] WARN: ${w}`);
  }
  if (errors.length > 0) {
    for (const e of errors) {
      console.error(`[opencoder env] FATAL: ${e}`);
    }
    process.exit(1);
  }

  const server = await buildServer();
  try {
    await server.listen({ host: env.HOST, port: env.PORT });
    server.log.info({ url: `http://${env.HOST}:${env.PORT}` }, 'opencoder api listening');
    // Pre-pull docker images in the background so the first /run isn't a long
    // image fetch. Non-blocking — listen is already up. Failures are logged but
    // don't crash the server (cold pull still happens on demand).
    void prepullImages({
      log: (m: string) => server.log.info({ scope: 'exec/prepull' }, m),
    })
      .then(() => {
        // Start the warm container pool only after images are present.
        // Pool.start() runs `docker run -d`, which would itself pull the image
        // if missing — but pre-pull deduplicates network fetch + makes the
        // first acquire faster.
        const pool = getPool();
        return pool
          .start()
          .catch((err: unknown) => server.log.warn({ err }, 'pool start failed'));
      })
      .catch((err) => server.log.warn({ err }, 'prepull failed'));

    // Tear down pooled containers on graceful shutdown so we don't leak them.
    const shutdown = async (signal: string) => {
      server.log.info({ signal }, 'shutting down');
      try {
        await getPool().shutdown();
      } catch (err) {
        server.log.warn({ err }, 'pool shutdown failed');
      }
      try {
        await server.close();
      } catch {
        /* ignore */
      }
      process.exit(0);
    };
    process.once('SIGTERM', () => void shutdown('SIGTERM'));
    process.once('SIGINT', () => void shutdown('SIGINT'));
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
};

void start();
