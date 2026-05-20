import { useEffect, useRef, useState } from 'react';
import { CollabClient, type CollabStatus, type PresenceUser } from './collab';
import { getToken } from './api';
import { useAuth } from './authStore';
import { useToasts } from './toast';

export function useCollab(slug: string | undefined): {
  client: CollabClient | null;
  status: CollabStatus;
  presence: Record<string, PresenceUser>;
} {
  const token = getToken();
  const myId = useAuth((s) => s.user?.id);
  const pushToast = useToasts((s) => s.push);

  // CollabClient owns a WebSocket, so we create + tear it down inside the
  // effect (not in useMemo). React 18 StrictMode mounts effects twice in dev,
  // and a useMemo'd client would survive the first cleanup with a closed
  // socket - leaving the UI permanently stuck at "closed". Doing it here lets
  // the second mount instantiate a fresh client cleanly.
  const [client, setClient] = useState<CollabClient | null>(null);
  const [status, setStatus] = useState<CollabStatus>('connecting');
  const [presence, setPresence] = useState<Record<string, PresenceUser>>({});

  // Toast on join/leave by diffing the presence map. We skip the very first
  // snapshot so users don't see "Alice joined" for everyone already in the pad
  // when they themselves connect.
  const seenIds = useRef<Set<string> | null>(null);
  const presenceRef = useRef<Record<string, PresenceUser>>({});

  useEffect(() => {
    if (!slug || !token) {
      setClient(null);
      setStatus('closed');
      setPresence({});
      return;
    }
    const c = new CollabClient(slug, token);
    setClient(c);
    setStatus('connecting');
    setPresence({});
    presenceRef.current = {};
    seenIds.current = null;

    const u1 = c.onStatus(setStatus);
    const u2 = c.onPresence((next) => {
      setPresence(next);
      const nextIds = new Set(Object.keys(next));
      if (seenIds.current === null) {
        seenIds.current = nextIds;
        presenceRef.current = next;
        return;
      }
      const prev = seenIds.current;
      for (const id of nextIds) {
        if (!prev.has(id) && id !== myId) {
          pushToast(`${next[id].name} joined`, 'info');
        }
      }
      for (const id of prev) {
        if (!nextIds.has(id) && id !== myId) {
          const leaver = presenceRef.current[id] ?? next[id];
          pushToast(`${leaver?.name ?? 'Someone'} left`, 'info');
        }
      }
      seenIds.current = nextIds;
      presenceRef.current = next;
    });
    return () => {
      u1();
      u2();
      c.close();
      seenIds.current = null;
    };
    // myId/pushToast come from stable zustand selectors; intentionally omitted.
  }, [slug, token]);

  return { client, status, presence };
}
