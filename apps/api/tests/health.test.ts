import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AppServer } from '../src/server.js';
import { buildServer } from '../src/server.js';

let server: AppServer;

beforeAll(async () => {
  server = await buildServer({ test: true });
});

afterAll(async () => {
  await server.close();
});

describe('health', () => {
  it('GET /health returns ok', async () => {
    const res = await server.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.name).toBe('opencoder');
  });

  it('GET /api/health returns ok', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
  });
});
