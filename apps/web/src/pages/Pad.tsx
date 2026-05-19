import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { editor as MonacoEditorTypes } from 'monaco-editor';
import { MonacoBinding } from 'y-monaco';
import type { AIReviewComment, RunResult } from '@opencoder/shared';
import { LANGUAGES } from '@opencoder/shared';
import { AppHeader } from '../components/AppHeader';
import { Editor } from '../components/Editor';
import { OutputPanel } from '../components/OutputPanel';
import { FileTree } from '../components/FileTree';
import { Chat } from '../components/Chat';
import { Terminal } from '../components/Terminal';
import { AIReviewPanel } from '../components/AIReviewPanel';
import { InvitesPanel } from '../components/InvitesPanel';
import { padsApi } from '../lib/pads';
import { execApi } from '../lib/exec';
import { useCollab } from '../lib/useCollab';
import { useAuth } from '../lib/authStore';
import { canEditRole } from '../lib/roles';

type RightTab = 'output' | 'chat' | 'terminal' | 'review';

export function Pad() {
  const { slug = '' } = useParams<{ slug: string }>();
  const { user } = useAuth();
  const pad = useQuery({
    queryKey: ['pad', slug],
    queryFn: () => padsApi.get(slug),
    enabled: !!slug,
  });
  const { client, status, presence } = useCollab(slug);

  const [activeFileId, setActiveFileId] = useState<string | null>(null);
  const [language, setLanguage] = useState('python');
  const [tab, setTab] = useState<RightTab>('output');
  const [result, setResult] = useState<RunResult | undefined>();
  const [invitesOpen, setInvitesOpen] = useState(false);
  const [aiComments, setAiComments] = useState<AIReviewComment[]>([]);

  // editor + Yjs binding
  const editorRef = useRef<MonacoEditorTypes.IStandaloneCodeEditor | null>(null);
  const bindingRef = useRef<MonacoBinding | null>(null);

  useEffect(() => {
    if (pad.data && !activeFileId) {
      const first = pad.data.files[0];
      if (first) {
        setActiveFileId(first.id);
        setLanguage(first.language);
      }
    }
  }, [pad.data, activeFileId]);

  // Re-bind Yjs when active file or editor changes.
  useEffect(() => {
    if (!client || !activeFileId || !editorRef.current) return;
    const doc = client.getDoc(activeFileId);
    const text = doc.getText('content');
    const model = editorRef.current.getModel();
    if (!model) return;
    const binding = new MonacoBinding(text, model, new Set([editorRef.current]));
    bindingRef.current = binding;
    return () => {
      binding.destroy();
      bindingRef.current = null;
    };
  }, [client, activeFileId]);

  const myRole = pad.data?.pad.myRole ?? 'viewer';
  const editAllowed = canEditRole(myRole);

  // Broadcast presence whenever active file or user changes.
  useEffect(() => {
    if (!client || !user || !activeFileId) return;
    client.setSelfPresence({ fileId: activeFileId, userId: user.id, name: user.name });
  }, [client, user, activeFileId]);

  const activeFile = useMemo(
    () => pad.data?.files.find((f) => f.id === activeFileId),
    [pad.data, activeFileId],
  );

  const run = useMutation({
    mutationFn: () => {
      const source = bindingRef.current
        ? (editorRef.current?.getValue() ?? '')
        : '';
      return execApi.run(slug, {
        source,
        language,
        filename: activeFile?.name,
      });
    },
    onSuccess: (r) => {
      setResult(r);
      setTab('output');
    },
  });

  // Cmd/Ctrl+Enter: run
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        if (editAllowed) run.mutate();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [run, editAllowed]);

  if (pad.isLoading) return <div className="p-8 text-zinc-400">loading…</div>;
  if (pad.error)
    return (
      <div className="p-8 text-red-400">
        Couldn't load pad. <Link to="/dashboard" className="underline">Back</Link>
      </div>
    );
  if (!pad.data) return null;

  const isInterview = pad.data.pad.kind === 'interview';
  const presenceList = Object.values(presence).filter((p) => p.userId !== user?.id);

  return (
    <div className="h-screen flex flex-col">
      <AppHeader />
      <div className="border-b border-zinc-800 px-4 py-2 flex items-center gap-3 text-sm">
        <h2 className="font-medium">{pad.data.pad.title}</h2>
        <span className="text-xs text-zinc-500">{slug}</span>
        <ConnectionDot status={status} />
        <div className="flex items-center gap-1">
          {presenceList.map((p) => (
            <span
              key={p.userId}
              title={p.name}
              className="size-2 rounded-full"
              style={{ backgroundColor: p.color }}
            />
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          {isInterview && (
            <Link to={`/p/${slug}/interview`} className="btn-secondary !py-1">
              Interview view
            </Link>
          )}
          <Link to={`/p/${slug}/playback`} className="btn-ghost !py-1">
            Playback
          </Link>
          {myRole === 'owner' && (
            <button className="btn-ghost !py-1" onClick={() => setInvitesOpen(true)}>
              Share
            </button>
          )}
          <select
            className="input !py-1 !text-sm"
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            disabled={!editAllowed}
          >
            {Object.values(LANGUAGES).map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </select>
          <button
            className="btn-primary !py-1"
            onClick={() => run.mutate()}
            disabled={!editAllowed || run.isPending}
          >
            {run.isPending ? 'Running…' : 'Run ⌘↵'}
          </button>
        </div>
      </div>

      <div className="flex-1 grid grid-cols-[220px_1fr_420px] min-h-0">
        <aside className="border-r border-zinc-800 p-2 overflow-y-auto">
          <FileTree
            slug={slug}
            files={pad.data.files}
            activeFileId={activeFileId}
            onActivate={(f) => {
              setActiveFileId(f.id);
              setLanguage(f.language);
            }}
            canEdit={editAllowed}
          />
          <div className="text-xs uppercase tracking-wide text-zinc-500 px-2 mt-4 mb-1">
            Members
          </div>
          {pad.data.members.map((m) => (
            <div key={m.id} className="px-2 py-1 text-xs text-zinc-400">
              {m.name} <span className="text-zinc-600">· {m.role}</span>
            </div>
          ))}
        </aside>
        <main className="min-w-0 min-h-0">
          <Editor
            language={language}
            value=""
            onMount={(ed) => {
              editorRef.current = ed;
              // value will be driven by Yjs binding once active file is set
            }}
          />
        </main>
        <section className="border-l border-zinc-800 min-w-0 flex flex-col min-h-0">
          <div className="flex border-b border-zinc-800">
            {(
              [
                ['output', 'Output'],
                ['chat', 'Chat'],
                ['terminal', 'Terminal'],
                ['review', 'AI'],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                onClick={() => setTab(k)}
                className={`flex-1 py-2 text-xs uppercase tracking-wide ${
                  tab === k
                    ? 'bg-zinc-900 text-zinc-100 border-b-2 border-brand-400'
                    : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="flex-1 min-h-0">
            {tab === 'output' && <OutputPanel running={run.isPending} result={result} />}
            {tab === 'chat' && (
              <Chat slug={slug} client={client} myUserId={user?.id ?? null} />
            )}
            {tab === 'terminal' && <Terminal slug={slug} active={tab === 'terminal'} />}
            {tab === 'review' && (
              <AIReviewPanel slug={slug} comments={aiComments} setComments={setAiComments} />
            )}
          </div>
        </section>
      </div>

      {invitesOpen && <InvitesPanel slug={slug} onClose={() => setInvitesOpen(false)} />}
    </div>
  );
}

function ConnectionDot({ status }: { status: string }) {
  const colors: Record<string, string> = {
    connecting: 'bg-amber-400',
    reconnecting: 'bg-amber-400',
    connected: 'bg-emerald-400',
    closed: 'bg-zinc-600',
  };
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-xs text-zinc-500`}
      title={`collab ${status}`}
    >
      <span className={`size-1.5 rounded-full ${colors[status] ?? 'bg-zinc-600'}`} />
      {status}
    </span>
  );
}
