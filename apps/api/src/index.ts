import { env, validateEnv } from './env.js';
import { buildServer } from './server.js';
import { prepullImages } from './exec/prepull.js';

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
    }).catch((err) => server.log.warn({ err }, 'prepull failed'));
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
};

void start();
