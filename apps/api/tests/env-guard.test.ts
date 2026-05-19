import { describe, expect, it } from 'vitest';
import { DEV_JWT_SECRET, validateEnv, type Env } from '../src/env.js';

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    NODE_ENV: 'development',
    HOST: '0.0.0.0',
    PORT: 4000,
    DATABASE_URL: 'file:./test.db',
    JWT_SECRET: DEV_JWT_SECRET,
    PUBLIC_BASE_URL: 'http://localhost:4000',
    DATA_DIR: './data',
    EXEC_DEFAULT_TIMEOUT_MS: 5000,
    EXEC_MAX_TIMEOUT_MS: 15000,
    EXEC_MEMORY_MB: 256,
    EXEC_CPU: '1',
    EXEC_FORCE_LOCAL: false,
    TERMINAL_IDLE_MS: 600_000,
    RATE_LIMIT_PER_MINUTE: 120,
    ...overrides,
  } as Env;
}

describe('validateEnv (production guard)', () => {
  it('refuses to boot when JWT_SECRET is the dev fallback', () => {
    const { errors } = validateEnv(makeEnv({ NODE_ENV: 'production', JWT_SECRET: DEV_JWT_SECRET }));
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toMatch(/JWT_SECRET/);
    expect(errors[0]).toMatch(/openssl rand/);
  });

  it('refuses to boot when JWT_SECRET is shorter than 32 chars', () => {
    const { errors } = validateEnv(
      makeEnv({ NODE_ENV: 'production', JWT_SECRET: 'a'.repeat(31) }),
    );
    expect(errors.length).toBe(1);
    expect(errors[0]).toMatch(/at least 32 characters/);
  });

  it('passes with a strong 32+ char secret', () => {
    const { errors, warnings } = validateEnv(
      makeEnv({
        NODE_ENV: 'production',
        JWT_SECRET: 'a'.repeat(64),
        ALLOWED_ORIGINS: 'https://example.com',
      }),
    );
    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it('warns when EXEC_FORCE_LOCAL is true in production', () => {
    const { errors, warnings } = validateEnv(
      makeEnv({
        NODE_ENV: 'production',
        JWT_SECRET: 'a'.repeat(64),
        EXEC_FORCE_LOCAL: true,
        ALLOWED_ORIGINS: 'https://example.com',
      }),
    );
    expect(errors).toEqual([]);
    expect(warnings.some((w) => /EXEC_FORCE_LOCAL/.test(w))).toBe(true);
  });

  it('warns when ALLOWED_ORIGINS is unset in production', () => {
    const { errors, warnings } = validateEnv(
      makeEnv({
        NODE_ENV: 'production',
        JWT_SECRET: 'a'.repeat(64),
      }),
    );
    expect(errors).toEqual([]);
    expect(warnings.some((w) => /ALLOWED_ORIGINS/.test(w))).toBe(true);
  });
});

describe('validateEnv (development)', () => {
  it('warns but does not error when JWT_SECRET is the dev fallback', () => {
    const { errors, warnings } = validateEnv(
      makeEnv({ NODE_ENV: 'development', JWT_SECRET: DEV_JWT_SECRET }),
    );
    expect(errors).toEqual([]);
    expect(warnings.some((w) => /default dev value/.test(w))).toBe(true);
  });

  it('stays quiet when JWT_SECRET is set to a real value in dev', () => {
    const { errors, warnings } = validateEnv(
      makeEnv({ NODE_ENV: 'development', JWT_SECRET: 'some-real-secret-value-32chars+' }),
    );
    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it('does not enforce ALLOWED_ORIGINS in dev', () => {
    const { errors, warnings } = validateEnv(
      makeEnv({ NODE_ENV: 'development', JWT_SECRET: 'some-real-secret-value-32chars+' }),
    );
    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
  });
});
