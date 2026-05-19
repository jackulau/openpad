import { useEffect, useMemo, useRef, useState } from 'react';
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
  const client = useMemo(() => {
    if (!slug || !token) return null;
    return new CollabClient(slug, token);
  }, [slug, token]);

  const [status, setStatus] = useState<CollabStatus>('connecting');
  const [presence, setPresence] = useState<Record<string, PresenceUser>>({});

  // Toast on join/leave by diffing the presence map. We skip the very first
  // snapshot so users don't see "Alice joined" for everyone already in the pad
  // when they themselves connect.
  const seenIds = useRef<Set<string> | null>(null);

  useEffect(() => {
    if (!client) return;
    const u1 = client.onStatus(setStatus);
    const u2 = client.onPresence((next) => {
      setPresence(next);
      const nextIds = new Set(Object.keys(next));
      if (seenIds.current === null) {
        seenIds.current = nextIds;
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
          const leaver = presence[id] ?? next[id];
          pushToast(`${leaver?.name ?? 'Someone'} left`, 'info');
        }
      }
      seenIds.current = nextIds;
    });
    return () => {
      u1();
      u2();
      client.close();
      seenIds.current = null;
    };
    // myId/pushToast are stable refs (zustand selectors); intentionally not in deps.
  }, [client]);

  return { client, status, presence };
}
