import { z } from 'zod';

// The dev/test fallback for JWT_SECRET. Boot-time validation refuses this value
// in production so a forgotten .env can't silently ship with a publicly-known
// signing key.
export const DEV_JWT_SECRET = 'dev-secret-change-me-please-32chars';

// z.coerce.boolean uses Boolean(x), so "false"/"0" both become true. Use an
// explicit allow-list so EXEC_FORCE_LOCAL=false actually means false.
export const strictBool = z
  .union([z.boolean(), z.string(), z.undefined()])
  .transform((v) => {
    if (typeof v === 'boolean') return v;
    if (v === undefined) return false;
    return /^(1|true|yes|on)$/i.test(v.trim());
  });

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().default('file:./dev.db'),
  JWT_SECRET: z.string().min(16).default(DEV_JWT_SECRET),
  COOKIE_DOMAIN: z.string().optional(),
  PUBLIC_BASE_URL: z.string().default('http://localhost:4000'),
  DATA_DIR: z.string().default('./data'),
  EXEC_DEFAULT_TIMEOUT_MS: z.coerce.number().default(5000),
  EXEC_MAX_TIMEOUT_MS: z.coerce.number().default(15000),
  EXEC_MEMORY_MB: z.coerce.number().default(256),
  EXEC_CPU: z.string().default('1'),
  EXEC_FORCE_LOCAL: strictBool.default(false),
  // Pre-pull docker images for all configured languages on API boot. Eliminates
  // the slow first-run image pull. Set false in CI / local dev where images are
  // already cached or where pulls would be wasted.
  EXEC_PREPULL: strictBool.default(true),
  // Number of warm docker containers kept ready per language in EXEC_POOL_LANGS.
  // 0 disables the pool entirely (forces cold `docker run --rm` per /run, prior
  // behavior). Each warm slot consumes EXEC_MEMORY_MB of RAM while idle.
  EXEC_POOL_SIZE: z.coerce.number().int().min(0).default(2),
  // Comma-separated lang IDs to keep warm. Default covers the hot path
  // (Python/JavaScript/Go interpreted langs where cold-start dominates).
  EXEC_POOL_LANGS: z.string().default('python312,node20,go122'),
  // Max size of the per-process compile-artifact cache (in MB). 0 disables.
  // LRU-evicted; survives process lifetime only (no persistence across restart).
  EXEC_COMPILE_CACHE_MAX_MB: z.coerce.number().int().min(0).default(512),
  // Max concurrent /run + /run-stream invocations per pad. The 6th from the
  // same pad gets HTTP 429 until one finishes. Prevents one user from monopolizing
  // the warm pool while siblings starve.
  EXEC_PER_PAD_CONCURRENCY: z.coerce.number().int().min(1).default(5),
  TERMINAL_IDLE_MS: z.coerce.number().default(10 * 60_000),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().default(120),
  // Disable all rate limiting (global + per-route, incl. guest-signup). Intended
  // for automated e2e where a single IP makes many signups/run and would trip the
  // limiter into 429s, producing flaky failures. Ignored in production (see
  // buildServer) so a stray env can't strip rate limits from a live deployment.
  RATE_LIMIT_DISABLED: strictBool.default(false),
  ALLOWED_ORIGINS: z.string().optional(),
});

export const env = schema.parse(process.env);
export type Env = z.infer<typeof schema>;

export interface EnvValidationResult {
  errors: string[];
  warnings: string[];
}

// Pure function so tests can pass synthetic env objects without re-importing env.ts.
// Errors are fatal (entry point exits); warnings only log to stderr.
export function validateEnv(e: Env): EnvValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const isProd = e.NODE_ENV === 'production';
  const isWeakSecret = e.JWT_SECRET === DEV_JWT_SECRET;
  const isShortSecret = e.JWT_SECRET.length < 32;

  if (isProd) {
    if (isWeakSecret) {
      errors.push(
        'JWT_SECRET must be set to a strong random string in production. ' +
          'It is currently the public dev fallback. Generate one with: openssl rand -hex 32',
      );
    } else if (isShortSecret) {
      errors.push(
        `JWT_SECRET must be at least 32 characters in production (currently ${e.JWT_SECRET.length}). ` +
          'Generate one with: openssl rand -hex 32',
      );
    }
    if (e.EXEC_FORCE_LOCAL) {
      warnings.push(
        'EXEC_FORCE_LOCAL=true in production: untrusted code runs on the host without ' +
          'Docker isolation. Only safe for trusted-users LAN deployments.',
      );
    }
    if (!e.ALLOWED_ORIGINS || !e.ALLOWED_ORIGINS.trim()) {
      warnings.push(
        'ALLOWED_ORIGINS is unset in production: CORS will reflect any request Origin. ' +
          'Set ALLOWED_ORIGINS to a comma-separated allow-list before exposing publicly.',
      );
    }
    if (e.RATE_LIMIT_DISABLED) {
      warnings.push(
        'RATE_LIMIT_DISABLED=true is ignored in production: rate limiting stays ON. ' +
          'This flag is only for automated e2e/test runs.',
      );
    }
  } else if (isWeakSecret) {
    warnings.push(
      'JWT_SECRET is still the default dev value. Set a real one in .env before deploying.',
    );
  }

  return { errors, warnings };
}
