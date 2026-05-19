import { env, validateEnv } from './env.js';
import { buildServer } from './server.js';

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
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
};

void start();
