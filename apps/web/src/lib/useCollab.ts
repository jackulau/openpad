import { useEffect, useMemo, useState } from 'react';
import { CollabClient, type CollabStatus, type PresenceUser } from './collab';
import { getToken } from './api';

export function useCollab(slug: string | undefined): {
  client: CollabClient | null;
  status: CollabStatus;
  presence: Record<string, PresenceUser>;
} {
  const token = getToken();
  const client = useMemo(() => {
    if (!slug || !token) return null;
    return new CollabClient(slug, token);
  }, [slug, token]);

  const [status, setStatus] = useState<CollabStatus>('connecting');
  const [presence, setPresence] = useState<Record<string, PresenceUser>>({});

  useEffect(() => {
    if (!client) return;
    const u1 = client.onStatus(setStatus);
    const u2 = client.onPresence(setPresence);
    return () => {
      u1();
      u2();
      client.close();
    };
  }, [client]);

  return { client, status, presence };
}
