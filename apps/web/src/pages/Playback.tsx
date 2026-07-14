import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import * as Y from 'yjs';
import { AppHeader } from '../components/AppHeader';
import { Editor } from '../components/Editor';
import { api } from '../lib/api';

interface PlaybackEvent {
  id: string;
  ts: number;
  kind: 'yjs' | 'run' | 'chat' | 'snapshot' | 'file' | 'terminal';
  fileId: string | null;
  userId: string | null;
  userName: string | null;
  payload?: string;
  meta?: { truncated?: boolean };
}

interface TermFragment {
  s: 'i' | 'o';
  d: string;
  t: number;
}

interface Timeline {
  padId: string;
  files: Array<{ id: string; name: string; language: string }>;
  events: PlaybackEvent[];
  startedAt: string;
  endedAt: string;
}

const SPEEDS = [0.5, 1, 2, 4] as const;

export function Playback() {
  const { slug = '' } = useParams<{ slug: string }>();
  const [searchParams] = useSearchParams();
  const recording = searchParams.get('recording') ?? null;
  const tl = useQuery({
    queryKey: ['playback', slug, recording],
    queryFn: () =>
      api.get<Timeline>(
        recording
          ? `/api/pads/${slug}/playback?recording=${encodeURIComponent(recording)}`
          : `/api/pads/${slug}/playback`,
      ),
  });

  const [activeFileId, setActiveFileId] = useState<string | null>(null);
  const [scrubIndex, setScrubIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);

  const events = tl.data?.events ?? [];
  const max = events.length;

  // Refs let the play loop read the live scrub position + events without listing
  // them as effect deps — depending on scrubIndex (which the loop itself sets)
  // would tear down and recreate the timer every tick, ignoring the real delay
  // and racing to the end in one frame.
  const eventsRef = useRef(events);
  eventsRef.current = events;
  const scrubRef = useRef(scrubIndex);
  scrubRef.current = scrubIndex;

  useEffect(() => {
    if (tl.data && !activeFileId && tl.data.files[0]) {
      setActiveFileId(tl.data.files[0].id);
    }
  }, [tl.data, activeFileId]);

  useEffect(() => {
    if (!playing || max === 0) return;
    let cancelled = false;
    let handle: ReturnType<typeof setTimeout>;
    const tick = (): void => {
      if (cancelled) return;
      const cur = scrubRef.current;
      if (cur >= max) {
        setPlaying(false);
        return;
      }
      const nextIndex = cur + 1;
      scrubRef.current = nextIndex;
      setScrubIndex(nextIndex);
      const evNext = eventsRef.current[nextIndex];
      const evNow = eventsRef.current[nextIndex - 1];
      const delay = evNext && evNow ? Math.min(Math.max(20, (evNext.ts - evNow.ts) / speed), 1500) : 100;
      handle = setTimeout(tick, delay);
    };
    handle = setTimeout(tick, 0);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [playing, speed, max]);

  const { sourceText, runEvents, chatEvents, terminalEvents } = useMemo(() => {
    if (!tl.data || !activeFileId)
      return { sourceText: '', runEvents: [], chatEvents: [], terminalEvents: [] };
    const doc = new Y.Doc();
    const upTo = events.slice(0, scrubIndex);
    for (const e of upTo) {
      if ((e.kind === 'yjs' || e.kind === 'snapshot') && e.fileId === activeFileId && e.payload) {
        try {
          Y.applyUpdate(doc, new Uint8Array(base64decode(e.payload)));
        } catch {
          // ignore malformed updates
        }
      }
    }
    return {
      sourceText: doc.getText('content').toString(),
      runEvents: upTo.filter((e) => e.kind === 'run'),
      chatEvents: upTo.filter((e) => e.kind === 'chat'),
      terminalEvents: upTo.filter((e) => e.kind === 'terminal'),
    };
  }, [tl.data, activeFileId, scrubIndex, events]);

  if (tl.isLoading) return <div className="p-8 text-secondary">loading playback…</div>;
  if (tl.isError)
    return (
      <div className="p-8 text-danger">
        Couldn't load playback. <Link to="/dashboard" className="underline">Back</Link>
      </div>
    );
  if (!tl.data) return null;

  const activeFile = tl.data.files.find((f) => f.id === activeFileId);
  const at = events[Math.max(0, scrubIndex - 1)];
  const currentTime = at ? new Date(at.ts).toLocaleTimeString() : '-';

  return (
    <div className="h-screen flex flex-col">
      <AppHeader />
      <div className="border-b border-line px-4 py-2 flex items-center gap-3">
        <h2 className="font-medium text-sm">Playback</h2>
        {recording && (
          <span className="chip-accent">
            recording window
          </span>
        )}
        <Link to={`/p/${slug}`} className="text-xs text-accent underline">
          back to pad
        </Link>
      </div>
      <div className="flex-1 grid grid-cols-[180px_1fr_320px]">
        <aside className="border-r border-line p-2">
          <div className="text-xs uppercase tracking-wide text-subtle px-2 mb-1">Files</div>
          {tl.data.files.map((f) => (
            <button
              key={f.id}
              className={`block w-full text-left px-2 py-1 rounded text-sm ${
                f.id === activeFileId ? 'bg-elevated text-primary' : 'text-secondary hover:bg-surface'
              }`}
              onClick={() => setActiveFileId(f.id)}
            >
              {f.name}
            </button>
          ))}
        </aside>
        <main className="min-w-0 flex flex-col">
          <div className="flex-1 min-h-0">
            <Editor
              value={sourceText}
              readOnly
              language={activeFile?.language ?? 'plaintext'}
            />
          </div>
          <div className="border-t border-line p-3 space-y-2">
            <div className="flex items-center gap-3">
              <button
                className="btn-secondary !py-1"
                onClick={() => setPlaying((p) => !p)}
                disabled={max === 0}
              >
                {playing ? ' Pause' : '▶ Play'}
              </button>
              <select
                className="input !py-1 !text-sm w-20"
                value={speed}
                onChange={(e) => setSpeed(Number(e.target.value) as typeof speed)}
              >
                {SPEEDS.map((s) => (
                  <option key={s} value={s}>
                    {s}x
                  </option>
                ))}
              </select>
              <span className="text-xs text-subtle">
                {scrubIndex} / {max} · {currentTime}
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={max}
              value={scrubIndex}
              onChange={(e) => {
                setPlaying(false);
                setScrubIndex(Number(e.target.value));
              }}
              className="w-full"
            />
          </div>
        </main>
        <aside className="border-l border-line min-w-0 flex flex-col">
          <div className="border-b border-line px-3 py-1.5 text-xs uppercase tracking-wide text-subtle">
            Events
          </div>
          <div className="overflow-y-auto p-3 text-xs space-y-2">
            {chatEvents.map((c) => (
              <div key={c.id} className="text-secondary">
                <span className="text-subtle">[chat]</span> <strong>{c.userName ?? '?'}:</strong>{' '}
                {c.payload}
              </div>
            ))}
            {runEvents.map((r) => {
              let meta: { language?: string; exitCode?: number } = {};
              try {
                meta = JSON.parse(r.payload ?? '{}');
              } catch {
                /* ignore */
              }
              return (
                <div key={r.id} className="text-secondary">
                  <span className="text-subtle">[run]</span>{' '}
                  <span className="text-accent">{meta.language}</span>{' '}
                  exit {meta.exitCode ?? '?'}
                </div>
              );
            })}
            {terminalEvents.length > 0 && (
              <div className="border-t border-line pt-2 mt-2">
                <div className="text-subtle uppercase tracking-wide mb-1">terminal</div>
                <pre className="font-mono text-[11px] leading-tight whitespace-pre-wrap break-all text-secondary">
                  {terminalEvents
                    .flatMap((e) => {
                      let frags: TermFragment[] = [];
                      try {
                        frags = JSON.parse(e.payload ?? '[]') as TermFragment[];
                      } catch {
                        /* ignore */
                      }
                      return frags.map((f) => (f.s === 'i' ? f.d : f.d));
                    })
                    .join('')}
                  {terminalEvents.some((e) => e.meta?.truncated) && (
                    <span className="text-danger">[truncated]</span>
                  )}
                </pre>
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

function base64decode(b64: string): Uint8Array {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}
