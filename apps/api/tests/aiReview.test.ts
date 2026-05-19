import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import http from 'node:http';
import { buildServer, type AppServer } from '../src/server.js';
import { prisma } from '../src/db.js';
import { truncateAll } from './helpers/testServer.js';
import { __test__, runAIReview } from '../src/services/aiReview.js';

let server: AppServer;
let token: string;
let slug: string;
const auth = (t: string) => ({ authorization: `Bearer ${t}` });

async function reg(email: string): Promise<string> {
  const r = await server.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { email, name: email.split('@')[0], password: 'password1234' },
  });
  return r.json().token as string;
}

beforeAll(async () => {
  server = await buildServer({ test: true });
});
afterAll(async () => {
  await server.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await truncateAll(prisma);
  token = await reg('ai@b.com');
  const p = await server.inject({
    method: 'POST',
    url: '/api/pads',
    headers: auth(token),
    payload: { language: 'python' },
  });
  slug = p.json().pad.slug;
});

describe('aiReview unit', () => {
  it('returns empty comments when provider=none', async () => {
    const res = await runAIReview({
      language: 'python',
      files: [{ name: 'main.py', language: 'python', content: 'print(1)' }],
    });
    expect(res.provider).toBe('none');
    expect(res.comments).toEqual([]);
  });

  it('parses well-formed JSON output', () => {
    const text = `{"comments":[{"file":"main.py","line":3,"severity":"warn","comment":"use snake_case"}]}`;
    const comments = __test__.extractComments(text);
    expect(comments).toHaveLength(1);
    expect(comments[0]).toMatchObject({ file: 'main.py', line: 3, severity: 'warn' });
  });

  it('parses fenced JSON blocks', () => {
    const text = '```json\n{"comments":[{"file":"a.py","line":1,"severity":"info","comment":"ok"}]}\n```';
    const comments = __test__.extractComments(text);
    expect(comments).toHaveLength(1);
    expect(comments[0].file).toBe('a.py');
  });

  it('drops malformed entries', () => {
    const text = `{"comments":[{"file":"a","line":1,"severity":"warn","comment":"ok"},{"file":"b","line":"nope","severity":"warn","comment":"x"}]}`;
    const comments = __test__.extractComments(text);
    expect(comments).toHaveLength(1);
  });
});

describe('aiReview HTTP', () => {
  it('returns empty review when AI_PROVIDER=none', async () => {
    const res = await server.inject({
      method: 'POST',
      url: `/api/pads/${slug}/ai-review`,
      headers: auth(token),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().provider).toBe('none');
    expect(res.json().comments).toEqual([]);
  });

  it('rejects non-collaborator', async () => {
    const other = await reg('o@b.com');
    const res = await server.inject({
      method: 'POST',
      url: `/api/pads/${slug}/ai-review`,
      headers: auth(other),
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('aiReview integration with mock provider', () => {
  let httpServer: http.Server;
  let mockUrl: string;

  beforeEach(async () => {
    httpServer = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        if (req.url?.includes('messages')) {
          // Anthropic-style
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(
            JSON.stringify({
              content: [
                {
                  type: 'text',
                  text: '{"comments":[{"file":"main.py","line":1,"severity":"warn","comment":"prefer f-strings"}]}',
                },
              ],
            }),
          );
        } else {
          // OpenAI-style
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content:
                      '{"comments":[{"file":"main.py","line":2,"severity":"info","comment":"add type hints"}]}',
                  },
                },
              ],
            }),
          );
        }
      });
    });
    await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
    const addr = httpServer.address();
    if (!addr || typeof addr === 'string') throw new Error('no addr');
    mockUrl = `http://127.0.0.1:${addr.port}/v1/messages`;
  });
  afterEach(async () => {
    await new Promise<void>((res) => httpServer.close(() => res()));
  });

  it('calls mock anthropic and returns comments', async () => {
    process.env.ANTHROPIC_API_KEY = 'test';
    const res = await runAIReview({
      language: 'python',
      files: [{ name: 'main.py', language: 'python', content: 'print(1)' }],
      providerOverride: 'anthropic',
      baseUrlOverride: mockUrl,
    });
    expect(res.provider).toBe('anthropic');
    expect(res.comments).toHaveLength(1);
    expect(res.comments[0].comment).toContain('f-strings');
    delete process.env.ANTHROPIC_API_KEY;
  });

  it('returns empty comments on transient API failure', async () => {
    process.env.ANTHROPIC_API_KEY = 'test';
    const res = await runAIReview({
      language: 'python',
      files: [{ name: 'main.py', language: 'python', content: 'print(1)' }],
      providerOverride: 'anthropic',
      baseUrlOverride: 'http://127.0.0.1:1', // refused
    });
    expect(res.provider).toBe('anthropic');
    expect(res.comments).toEqual([]);
    delete process.env.ANTHROPIC_API_KEY;
  });
});
