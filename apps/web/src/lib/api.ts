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
  if (body !== undefined) headers['content-type'] = 'application/json';
  const token = getToken();
  if (token) headers['authorization'] = `Bearer ${token}`;

  const res = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
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
  patch: <T>(url: string, body?: unknown, opts?: { signal?: AbortSignal }) =>
    request<T>('PATCH', url, body, opts),
  delete: <T>(url: string, opts?: { signal?: AbortSignal }) =>
    request<T>('DELETE', url, undefined, opts),
};
