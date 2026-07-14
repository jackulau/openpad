import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { editor as MonacoEditorTypes } from 'monaco-editor';
import { MonacoBinding } from 'y-monaco';
import type { RunResult } from '@opencoder/shared';
import { groupedLanguages, resolveLanguage } from '@opencoder/shared';
import { AppHeader } from '../components/AppHeader';
import { Editor } from '../components/Editor';
import { OutputPanel } from '../components/OutputPanel';
import { FileTree } from '../components/FileTree';
import { Chat } from '../components/Chat';
import { Terminal } from '../components/Terminal';
import { InvitesPanel } from '../components/InvitesPanel';
import { AvatarStack } from '../components/AvatarStack';
import { RecordingsPanel } from '../components/RecordingsPanel';
import { WhiteboardCanvas } from '../components/WhiteboardCanvas';
import { MembersPanel } from '../components/MembersPanel';
import { NotesPanel } from '../components/NotesPanel';
import { PadSidebar, type SidebarTool } from '../components/PadSidebar';
import { ShortcutsModal, useShortcutsModal } from '../components/ShortcutsModal';
import { padsApi } from '../lib/pads';
import { filesApi } from '../lib/files';
import { execApi } from '../lib/exec';
import { useCollab } from '../lib/useCollab';
import { useAuth } from '../lib/authStore';
import { canEditRole } from '../lib/roles';
import { passwordApi } from '../lib/passwords';
import { HttpError } from '../lib/api';
import { useToasts } from '../lib/toast';
import { api } from '../lib/api';
import { useNavigate } from 'react-router-dom';

export function Pad() {
  const { slug = '' } = useParams<{ slug: string }>();
  const { user } = useAuth();
  const pad = useQuery({
    queryKey: ['pad', slug],
    queryFn: () => padsApi.get(slug),
    enabled: !!slug,
  });
  const { client, status, presence, rtt } = useCollab(slug);

  const [activeFileId, setActiveFileId] = useState<string | null>(null);
  const [language, setLanguage] = useState('python');
  const [sidebarTool, setSidebarTool] = useState<SidebarTool | null>('files');
  const [result, setResult] = useState<RunResult | undefined>();
  const [outputOpen, setOutputOpen] = useState(false);
  const [invitesOpen, setInvitesOpen] = useState(false);

  // editor + Yjs binding. `editorTick` bumps whenever onMount fires so dependent
  // effects (cursor presence, Yjs binding) can re-run after Monaco is ready.
  const editorRef = useRef<MonacoEditorTypes.IStandaloneCodeEditor | null>(null);
  const bindingRef = useRef<MonacoBinding | null>(null);
  const [editorTick, setEditorTick] = useState(0);

  useEffect(() => {
    if (pad.data && !activeFileId) {
      const first = pad.data.files[0];
      if (first) {
        setActiveFileId(first.id);
        setLanguage(first.language);
      }
      // Interview pads open on the problem (Notes), LeetCode-style, so the
      // candidate sees the prompt immediately. Only on first load.
      if (pad.data.pad.kind === 'interview') setSidebarTool('notes');
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
  }, [client, activeFileId, editorTick]);

  const myRole = pad.data?.pad.myRole ?? 'viewer';
  const editAllowed = canEditRole(myRole);

  // Broadcast presence whenever active file or user changes.
  useEffect(() => {
    if (!client || !user || !activeFileId) return;
    client.setSelfPresence({ fileId: activeFileId, userId: user.id, name: user.name });
  }, [client, user, activeFileId]);

  // Stream cursor + selection from Monaco into presence so peers see a live
  // caret + name label on the current file. Re-subscribed whenever the active
  // file changes or the editor remounts.
  useEffect(() => {
    if (!client || !user || !activeFileId || !editorRef.current) return;
    const editor = editorRef.current;
    const pushCursor = () => {
      const pos = editor.getPosition();
      const sel = editor.getSelection();
      if (!pos) return;
      const payload: Parameters<typeof client.setSelfPresence>[0] = {
        fileId: activeFileId,
        userId: user.id,
        name: user.name,
        cursor: { line: pos.lineNumber, column: pos.column },
      };
      if (sel && !sel.isEmpty()) {
        payload.selection = {
          startLine: sel.startLineNumber,
          startColumn: sel.startColumn,
          endLine: sel.endLineNumber,
          endColumn: sel.endColumn,
        };
      }
      client.setSelfPresence(payload);
    };
    pushCursor();
    const d1 = editor.onDidChangeCursorPosition(pushCursor);
    const d2 = editor.onDidChangeCursorSelection(pushCursor);
    return () => {
      d1.dispose();
      d2.dispose();
    };
  }, [client, user, activeFileId, editorTick]);

  // Remote cursors for the current file (exclude self).
  const remoteCursors = useMemo(() => {
    if (!activeFileId || !user) return [];
    const out: Array<{
      userId: string;
      name: string;
      color: string;
      cursor: { line: number; column: number };
      selection?: {
        startLine: number;
        startColumn: number;
        endLine: number;
        endColumn: number;
      };
    }> = [];
    for (const p of Object.values(presence)) {
      if (p.userId === user.id) continue;
      if (p.fileId !== activeFileId) continue;
      if (!p.cursor) continue;
      out.push({
        userId: p.userId,
        name: p.name,
        color: p.color,
        cursor: p.cursor,
        selection: p.selection,
      });
    }
    return out;
  }, [presence, activeFileId, user]);

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
      setOutputOpen(true);
    },
  });

  // Cmd/Ctrl+Enter: run. Alt+1..7: jump to sidebar tool (skipped when typing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        if (editAllowed) run.mutate();
        return;
      }
      const tag = (e.target as HTMLElement | null)?.tagName;
      const inField = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
      if (inField || e.metaKey || e.ctrlKey || e.altKey) return;
      const sidebarShortcuts: Record<string, SidebarTool> = {
        '1': 'notes',
        '2': 'files',
        '3': 'members',
        '4': 'chat',
        '5': 'terminal',
        '6': 'whiteboard',
        '7': 'recordings',
      };
      const target = sidebarShortcuts[e.key];
      if (target) {
        e.preventDefault();
        setSidebarTool((t) => (t === target ? null : target));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [run, editAllowed]);

  const shortcuts = useShortcutsModal();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const push = useToasts((s) => s.push);
  const fork = useMutation({
    mutationFn: () => api.post<{ pad: { slug: string } }>(`/api/pads/${slug}/fork`),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['pads'] });
      push('Forked to your account', 'success');
      navigate(`/p/${r.pad.slug}`);
    },
    onError: (e) => push(e instanceof HttpError ? e.error : 'Failed', 'error'),
  });

  // Switching the language picker also renames the active file to the new
  // language's default name AND swaps content to the matching template if the
  // user hasn't typed real code. Refetches the pad so the file tree updates.
  async function changeFileLanguage(next: string) {
    if (!activeFileId) return;
    try {
      const res = await filesApi.relanguage(slug, activeFileId, next);
      await qc.invalidateQueries({ queryKey: ['pad', slug] });
      push(
        res.contentReplaced
          ? `Switched to ${next} (template loaded)`
          : `Switched to ${next}`,
        'success',
      );
    } catch (e) {
      push(e instanceof HttpError ? e.error : 'Language change failed', 'error');
    }
  }

  if (pad.isLoading) return <div className="p-8 text-secondary">loading…</div>;
  if (pad.error) return <UnlockOrError slug={slug} onUnlocked={() => pad.refetch()} />;
  if (!pad.data) return null;

  const isInterview = pad.data.pad.kind === 'interview';
  const currentLang = resolveLanguage(language);
  const groupId = currentLang?.group ?? language;

  return (
    <div className="h-screen flex flex-col">
      <AppHeader />
      <div className="border-b border-line px-4 py-2 flex items-center gap-3 text-sm">
        <h2 className="font-medium">{pad.data.pad.title}</h2>
        <span className="text-xs text-subtle">{slug}</span>
        <ConnectionChip status={status} rtt={rtt} />
        <AvatarStack me={user ? { id: user.id, name: user.name } : null} presence={presence} />
        <div className="ml-auto flex items-center gap-2">
          {isInterview && (
            <Link to={`/p/${slug}/interview`} className="btn-secondary !py-1">
              Interview view
            </Link>
          )}
          <Link to={`/p/${slug}/playback`} className="btn-ghost !py-1">
            Playback
          </Link>
          <button
            className="btn-ghost !py-1"
            onClick={() => fork.mutate()}
            disabled={fork.isPending}
            title="Make my own copy"
          >
            {fork.isPending ? 'Forking…' : 'Fork'}
          </button>
          {myRole === 'owner' && (
            <button className="btn-ghost !py-1" onClick={() => setInvitesOpen(true)}>
              Share
            </button>
          )}
          <LanguagePicker
            value={language}
            onChange={(next) => {
              if (next === language) return;
              setLanguage(next);
              void changeFileLanguage(next);
            }}
            disabled={!editAllowed}
          />
          {currentLang?.version && (
            <select
              className="input !py-1 !text-sm"
              value={language}
              onChange={(e) => {
                const next = e.target.value;
                if (next === language) return;
                setLanguage(next);
                void changeFileLanguage(next);
              }}
              disabled={!editAllowed}
              title="Version"
            >
              {groupedLanguages()
                .find((g) => g.group === groupId)
                ?.versions.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.version}
                  </option>
                ))}
            </select>
          )}
          <button
            className="btn-primary !py-1.5 !px-3 inline-flex items-center gap-2"
            onClick={() => run.mutate()}
            disabled={!editAllowed || run.isPending}
            title="Run code (Cmd↵ / Ctrl+Enter)"
          >
            {run.isPending ? (
              <>
                <SpinnerIcon />
                <span>Running</span>
              </>
            ) : (
              <>
                <PlayIcon />
                <span>Run</span>
                <kbd className="kbd !bg-accent-fg/15 !text-accent-fg !border-accent-fg/30">Cmd↵</kbd>
              </>
            )}
          </button>
        </div>
      </div>

      <div className="flex-1 flex min-h-0">
        <PadSidebar
          active={sidebarTool}
          onSelect={setSidebarTool}
          badges={{
            recordings: pad.data.pad.autoRecord ? (
              <span className="block size-2 rounded-full bg-success animate-pulse" />
            ) : undefined,
          }}
        />
        {sidebarTool && (
          <section
            className={`border-r border-line bg-page flex flex-col min-h-0 ${
              sidebarTool === 'whiteboard' ? 'flex-1' : ''
            }`}
            style={
              sidebarTool === 'whiteboard'
                ? undefined
                : { width: sidebarTool === 'terminal' ? 480 : sidebarTool === 'notes' ? 420 : 320 }
            }
          >
            {sidebarTool === 'notes' && <NotesPanel slug={slug} />}
            {sidebarTool === 'files' && (
              <div className="p-2 overflow-y-auto h-full">
                <FileTree
                  slug={slug}
                  files={pad.data.files}
                  activeFileId={activeFileId}
                  onActivate={(f) => {
                    setActiveFileId(f.id);
                    setLanguage(f.language);
                  }}
                  canEdit={editAllowed}
                  presence={presence}
                  myUserId={user?.id ?? null}
                />
              </div>
            )}
            {sidebarTool === 'members' && (
              <MembersPanel slug={slug} myUserId={user?.id ?? null} myRole={myRole} />
            )}
            {sidebarTool === 'chat' && (
              <Chat slug={slug} client={client} myUserId={user?.id ?? null} />
            )}
            {sidebarTool === 'terminal' && (
              <Terminal slug={slug} active={sidebarTool === 'terminal'} />
            )}
            {sidebarTool === 'whiteboard' && client && (
              <WhiteboardCanvas client={client} active={sidebarTool === 'whiteboard'} />
            )}
            {sidebarTool === 'recordings' && (
              <RecordingsPanel
                slug={slug}
                autoRecord={pad.data.pad.autoRecord ?? false}
                canManage={myRole === 'owner'}
              />
            )}
          </section>
        )}
        {sidebarTool !== 'whiteboard' && (
          <main className="flex-1 flex flex-col min-w-0 min-h-0">
            <div className="flex-1 min-h-0">
              <Editor
                language={language}
                value=""
                remoteCursors={remoteCursors}
                onMount={(ed) => {
                  editorRef.current = ed;
                  setEditorTick((t) => t + 1);
                  // value will be driven by Yjs binding once active file is set
                }}
              />
            </div>
            <OutputDrawer
              open={outputOpen}
              running={run.isPending}
              result={result}
              onToggle={() => setOutputOpen((o) => !o)}
            />
          </main>
        )}
      </div>

      {invitesOpen && <InvitesPanel slug={slug} onClose={() => setInvitesOpen(false)} />}
      <ShortcutsModal open={shortcuts.open} onClose={() => shortcuts.setOpen(false)} />
    </div>
  );
}

function LanguagePicker({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  const groups = groupedLanguages();
  // Selection driven by group; mapping to the default version of the picked group.
  const current = resolveLanguage(value);
  const currentGroup = current?.group ?? value;
  return (
    <select
      className="input !py-1 !text-sm"
      value={currentGroup}
      onChange={(e) => {
        const g = groups.find((gg) => gg.group === e.target.value);
        if (!g) return;
        const def = g.versions.find((v) => v.isDefault) ?? g.versions[0];
        onChange(def.id);
      }}
      disabled={disabled}
    >
      {groups.map((g) => (
        <option key={g.group} value={g.group}>
          {g.label}
        </option>
      ))}
    </select>
  );
}

function UnlockOrError({ slug, onUnlocked }: { slug: string; onUnlocked: () => void }) {
  const preview = useQuery({
    queryKey: ['pad-preview', slug],
    queryFn: () => passwordApi.preview(slug),
    retry: false,
  });
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const unlock = useMutation({
    mutationFn: () => passwordApi.unlock(slug, password),
    onSuccess: () => {
      setErr(null);
      onUnlocked();
    },
    onError: (e) => {
      setErr(
        e instanceof HttpError
          ? e.error === 'wrong_password'
            ? 'Wrong password.'
            : e.error
          : 'Failed',
      );
    },
  });
  if (preview.isLoading)
    return <div className="p-8 text-secondary">checking pad…</div>;
  if (preview.error || !preview.data) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="card p-6 max-w-md w-full space-y-2 text-center">
          <h2 className="text-lg font-semibold">Pad not found</h2>
          <p className="text-sm text-secondary">
            This pad doesn't exist or has been deleted.
          </p>
          <Link to="/dashboard" className="btn-secondary inline-flex mt-2">
            Back to dashboard
          </Link>
        </div>
      </div>
    );
  }
  if (!preview.data.hasPassword) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="card p-6 max-w-md w-full space-y-2 text-center">
          <h2 className="text-lg font-semibold">Access denied</h2>
          <p className="text-sm text-secondary">
            You're not a member of this pad. Ask the owner for an invite.
          </p>
          <Link to="/dashboard" className="btn-secondary inline-flex mt-2">
            Back to dashboard
          </Link>
        </div>
      </div>
    );
  }
  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <form
        className="card p-6 max-w-md w-full space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (password) unlock.mutate();
        }}
      >
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">{preview.data.title}</h2>
          <p className="text-sm text-secondary">This pad is password protected.</p>
        </div>
        <label className="block">
          <span className="text-xs uppercase tracking-wide text-subtle">Password</span>
          <input
            type="password"
            autoFocus
            className="input mt-1"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {err && <div className="text-sm text-danger" role="alert">{err}</div>}
        <button
          type="submit"
          className="btn-primary w-full"
          disabled={!password || unlock.isPending}
        >
          {unlock.isPending ? 'Unlocking…' : 'Unlock'}
        </button>
      </form>
    </div>
  );
}

function ConnectionChip({ status, rtt }: { status: string; rtt: number | null }) {
  const colors: Record<string, string> = {
    connecting: 'bg-amber-400',
    reconnecting: 'bg-amber-400',
    connected: 'bg-success',
    closed: 'bg-muted',
  };
  const labels: Record<string, string> = {
    connecting: 'connecting…',
    reconnecting: 'reconnecting…',
    connected: 'live',
    closed: 'offline',
  };
  const label = labels[status] ?? status;
  const rttSuffix = status === 'connected' && rtt != null ? ` · ${rtt}ms` : '';
  const title =
    status === 'connected' && rtt != null
      ? `collab live · round-trip ${rtt}ms`
      : `collab ${status}`;
  return (
    <span
      className="inline-flex items-center gap-1.5 text-xs text-subtle"
      title={title}
      aria-label={title}
    >
      <span className={`size-1.5 rounded-full ${colors[status] ?? 'bg-muted'}`} />
      {label}
      {rttSuffix && <span className="text-subtle/80">{rttSuffix}</span>}
    </span>
  );
}

function PlayIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}
function SpinnerIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="animate-spin" aria-hidden="true">
      <path d="M21 12a9 9 0 1 1-6.21-8.56" />
    </svg>
  );
}

// Bottom drawer below the editor that holds the most-recent Run result. Auto-
// opens on Run; user can collapse via the chevron. Collapsed state shows a
// thin status bar (exit code + duration) so they can re-expand at a glance.
function OutputDrawer({
  open,
  running,
  result,
  onToggle,
}: {
  open: boolean;
  running: boolean;
  result: RunResult | undefined;
  onToggle: () => void;
}) {
  const height = open ? 220 : 32;
  return (
    <section
      className="border-t border-line bg-page flex flex-col transition-[height]"
      style={{ height }}
    >
      <button
        onClick={onToggle}
        className="flex items-center gap-2 px-3 h-8 text-xs text-secondary hover:text-primary hover:bg-hover/40 transition-colors"
        aria-expanded={open}
        aria-label={open ? 'Collapse output' : 'Expand output'}
      >
        <Chevron open={open} />
        <span className="font-medium uppercase tracking-wide">Output</span>
        {running && (
          <span className="ml-2 text-accent inline-flex items-center gap-1">
            <span className="size-1.5 rounded-full bg-accent animate-pulse" /> running
          </span>
        )}
        {!running && result && (
          <span className="ml-2 text-subtle">
            exit {String(result.exitCode)} · {result.durationMs}ms
          </span>
        )}
      </button>
      {open && (
        <div className="flex-1 min-h-0 overflow-hidden">
          <OutputPanel running={running} result={result} />
        </div>
      )}
    </section>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ transform: open ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform 150ms' }}
      aria-hidden="true"
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}
