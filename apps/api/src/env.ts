import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().default('file:./dev.db'),
  JWT_SECRET: z.string().min(16).default('dev-secret-change-me-please-32chars'),
  COOKIE_DOMAIN: z.string().optional(),
  PUBLIC_BASE_URL: z.string().default('http://localhost:4000'),
  DATA_DIR: z.string().default('./data'),
  EXEC_DEFAULT_TIMEOUT_MS: z.coerce.number().default(5000),
  EXEC_MAX_TIMEOUT_MS: z.coerce.number().default(15000),
  EXEC_MEMORY_MB: z.coerce.number().default(256),
  EXEC_CPU: z.string().default('1'),
  EXEC_FORCE_LOCAL: z.coerce.boolean().default(false),
  TERMINAL_IDLE_MS: z.coerce.number().default(10 * 60_000),
  AI_PROVIDER: z.enum(['anthropic', 'openai', 'none']).default('none'),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default('claude-sonnet-4-6'),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default('gpt-4o-mini'),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().default(120),
});

export const env = schema.parse(process.env);
export type Env = z.infer<typeof schema>;
