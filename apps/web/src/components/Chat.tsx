import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { CollabClient, ChatMessage } from '../lib/collab';

interface HistoryResponse {
  messages: ChatMessage[];
}

interface Props {
  slug: string;
  client: CollabClient | null;
  myUserId: string | null;
}

export function Chat({ slug, client, myUserId }: Props) {
  const history = useQuery({
    queryKey: ['chat', slug],
    queryFn: () => api.get<HistoryResponse>(`/api/pads/${slug}/messages`),
  });

  const [live, setLive] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const scrollerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!client) return;
    return client.onChat((m) => {
      setLive((prev) => [...prev, m]);
    });
  }, [client]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [live, history.data]);

  const all: ChatMessage[] = [...(history.data?.messages ?? []), ...live];

  return (
    <div className="flex flex-col h-full">
      <div className="border-b border-zinc-800 px-3 py-1.5 text-xs uppercase tracking-wide text-zinc-500">
        Chat
      </div>
      <div ref={scrollerRef} className="flex-1 overflow-y-auto p-3 space-y-2 text-sm">
        {history.isLoading && <div className="text-zinc-500">loading…</div>}
        {all.length === 0 && !history.isLoading && (
          <div className="text-zinc-500">No messages yet. Say hi.</div>
        )}
        {all.map((m, i) => {
          const mine = m.userId === myUserId;
          const showHeader =
            i === 0 ||
            all[i - 1].userId !== m.userId ||
            new Date(m.createdAt).getTime() - new Date(all[i - 1].createdAt).getTime() > 5 * 60_000;
          return (
            <div key={m.id ?? `${m.createdAt}-${i}`} className="text-sm">
              {showHeader && (
                <div className="text-xs text-zinc-500 flex items-center gap-1 mt-2">
                  <span className={mine ? 'text-brand-400' : 'text-zinc-300'}>{m.userName}</span>
                  <span>·</span>
                  <span>{new Date(m.createdAt).toLocaleTimeString()}</span>
                </div>
              )}
              <div className="text-zinc-100 whitespace-pre-wrap break-words">{m.body}</div>
            </div>
          );
        })}
      </div>
      <form
        className="border-t border-zinc-800 p-2 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const body = draft.trim();
          if (!body || !client) return;
          client.sendChat(body);
          setDraft('');
        }}
      >
        <input
          className="input !py-1.5 !text-sm flex-1"
          placeholder={client ? 'message…' : 'connecting…'}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={!client}
        />
        <button className="btn-primary !py-1.5" disabled={!client || !draft.trim()}>
          Send
        </button>
      </form>
    </div>
  );
}
