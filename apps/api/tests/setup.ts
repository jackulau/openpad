import { setupTestDatabase, type TestEnv } from './helpers/testServer.js';

let env: TestEnv | null = null;

export async function setup(): Promise<void> {
  process.env.EXEC_FORCE_LOCAL = 'true';
  env = setupTestDatabase();
  process.env.DATABASE_URL = env.dbUrl;
}

export async function teardown(): Promise<void> {
  env?.cleanup();
  env = null;
}
