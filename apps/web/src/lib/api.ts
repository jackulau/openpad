export interface ApiError {
  status: number;
  error: string;
  details?: unknown;
}

const TOKEN_KEY = 'oc_token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null): void {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export class HttpError extends Error implements ApiError {
  status: number;
  error: string;
  details?: unknown;
  constructor(status: number, error: string, details?: unknown) {
    super(`${status} ${error}`);
    this.status = status;
    this.error = error;
    this.details = details;
  }
}

async function request<T>(
  method: string,
  url: string,
  body?: unknown,
  opts: { signal?: AbortSignal } = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  // Fastify rejects bodyless POST/PATCH/DELETE with 415 when the route declares
  // a content-type body parser. Set it unconditionally for methods that can
  // carry a body; serialise `undefined` → `{}` so the wire is always valid JSON.
  const hasBody = method !== 'GET' && method !== 'HEAD';
  if (hasBody) headers['content-type'] = 'application/json';
  const token = getToken();
  if (token) headers['authorization'] = `Bearer ${token}`;

  const res = await fetch(url, {
    method,
    headers,
    body: hasBody ? JSON.stringify(body ?? {}) : undefined,
    credentials: 'include',
    signal: opts.signal,
  });
  const text = await res.text();
  const parsed = text ? safeJSON(text) : null;
  if (!res.ok) {
    throw new HttpError(res.status, (parsed?.error as string) ?? res.statusText, parsed?.details);
  }
  return parsed as T;
}

function safeJSON(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

export const api = {
  get: <T>(url: string, opts?: { signal?: AbortSignal }) => request<T>('GET', url, undefined, opts),
  post: <T>(url: string, body?: unknown, opts?: { signal?: AbortSignal }) =>
    request<T>('POST', url, body, opts),
  put: <T>(url: string, body?: unknown, opts?: { signal?: AbortSignal }) =>
    request<T>('PUT', url, body, opts),
  patch: <T>(url: string, body?: unknown, opts?: { signal?: AbortSignal }) =>
    request<T>('PATCH', url, body, opts),
  delete: <T>(url: string, opts?: { signal?: AbortSignal; body?: unknown }) =>
    request<T>('DELETE', url, opts?.body, { signal: opts?.signal }),
};

// Multipart upload with the bearer token. Kept separate from request() because
// FormData must set its own content-type (with boundary); we must not override it.
export async function uploadFile<T>(url: string, file: File, field = 'file'): Promise<T> {
  const form = new FormData();
  form.append(field, file);
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers['authorization'] = `Bearer ${token}`;
  const res = await fetch(url, { method: 'POST', headers, body: form, credentials: 'include' });
  const text = await res.text();
  const parsed = text ? safeJSON(text) : null;
  if (!res.ok) {
    throw new HttpError(res.status, (parsed?.error as string) ?? res.statusText, parsed?.details);
  }
  return parsed as T;
}
