import { useEffect, useState } from 'react';
import { getToken } from './api';

// Subscribe to /api/pads/presence (SSE) and return a {padId: count} map.
// Reconnects with exponential backoff on transient errors. Closes cleanly
// on unmount. Browser EventSource can't carry an Authorization header, so
// we use fetch + ReadableStream and parse the SSE wire format ourselves.
export function useLivePresence(): Record<string, number> {
  const [counts, setCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    let cancelled = false;
    let ac: AbortController | null = null;
    let backoff = 500;

    const connect = async () => {
      const token = getToken();
      if (!token) return;
      ac = new AbortController();
      try {
        const res = await fetch('/api/pads/presence', {
          headers: { authorization: `Bearer ${token}` },
          signal: ac.signal,
        });
        if (!res.ok || !res.body) throw new Error(`presence stream rejected: ${res.status}`);

        backoff = 500;
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = '';
        while (!cancelled) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let idx: number;
          while ((idx = buf.indexOf('\n\n')) >= 0) {
            const frame = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            const lines = frame.split('\n');
            let event = 'message';
            let data = '';
            for (const line of lines) {
              if (line.startsWith('event:')) event = line.slice(6).trim();
              else if (line.startsWith('data:')) data += line.slice(5).trim();
            }
            if (event === 'snapshot' && data) {
              try {
                const parsed = JSON.parse(data) as Record<string, number>;
                if (!cancelled) setCounts(parsed);
              } catch {
                /* malformed frame — ignore */
              }
            }
          }
        }
      } catch (err) {
        if (cancelled || (err as Error).name === 'AbortError') return;
      }
      if (!cancelled) {
        setTimeout(connect, backoff);
        backoff = Math.min(backoff * 2, 15000);
      }
    };

    void connect();
    return () => {
      cancelled = true;
      ac?.abort();
    };
  }, []);

  return counts;
}
