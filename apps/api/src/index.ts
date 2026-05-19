import { env } from './env.js';
import { buildServer } from './server.js';

const start = async () => {
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
