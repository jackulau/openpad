import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { groupedLanguages } from '@opencoder/shared';
import { AppHeader } from '../components/AppHeader';
import { padsApi } from '../lib/pads';
import { useLivePresence } from '../lib/usePresence';
import { useToasts } from '../lib/toast';
import { HttpError } from '../lib/api';

export function Dashboard() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const push = useToasts((s) => s.push);
  const groups = useMemo(() => groupedLanguages(), []);
  const [groupId, setGroupId] = useState('python');
  const [version, setVersion] = useState<string>(() => {
    const g = groups.find((gg) => gg.group === 'python');
    return (g?.versions.find((v) => v.isDefault) ?? g?.versions[0])?.id ?? 'python312';
  });
  const [kind, setKind] = useState<'sandbox' | 'interview'>('sandbox');
  const [template, setTemplate] = useState<'hello' | 'leetcode'>('hello');
  const [title, setTitle] = useState('');

  const versions = groups.find((g) => g.group === groupId)?.versions ?? [];

  const list = useQuery({ queryKey: ['pads'], queryFn: () => padsApi.list() });
  const presenceCount = useLivePresence();
  const create = useMutation({
    mutationFn: () =>
      padsApi.create({ title: title || undefined, language: version, kind, template }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['pads'] });
      navigate(`/p/${res.pad.slug}`);
    },
    onError: (e) => push(e instanceof HttpError ? e.error : 'Failed to create', 'error'),
  });
  const remove = useMutation({
    mutationFn: (slug: string) => padsApi.delete(slug),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pads'] }),
  });

  return (
    <>
      <AppHeader />
      <main className="max-w-6xl mx-auto px-6 py-8 space-y-10">
        <section className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Pads</h1>
          <p className="text-sm text-secondary">
            Spin up a sandbox, run code in real time, or open an interview room.
          </p>
        </section>

        <section className="card p-6 space-y-5 shadow-soft">
          <div className="flex items-center gap-3">
            <h2 className="text-base font-semibold">New pad</h2>
            <span className="chip">
              <kbd className="text-[10px] font-semibold">N</kbd>
            </span>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-12 gap-3">
            <Field label="Title" className="lg:col-span-5">
              <input
                className="input"
                placeholder="Optional"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </Field>
            <Field label="Language" className="lg:col-span-3">
              <select
                className="input"
                value={groupId}
                onChange={(e) => {
                  setGroupId(e.target.value);
                  const g = groups.find((gg) => gg.group === e.target.value);
                  const def = g?.versions.find((v) => v.isDefault) ?? g?.versions[0];
                  if (def) setVersion(def.id);
                }}
              >
                {groups.map((g) => (
                  <option key={g.group} value={g.group}>
                    {g.label}
                  </option>
                ))}
              </select>
            </Field>
            {versions.length > 1 && (
              <Field label="Version" className="lg:col-span-2">
                <select
                  className="input"
                  value={version}
                  onChange={(e) => setVersion(e.target.value)}
                >
                  {versions.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.version ?? v.id}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <Field label="Template" className="lg:col-span-2">
              <select
                className="input"
                value={template}
                onChange={(e) => setTemplate(e.target.value as 'hello' | 'leetcode')}
              >
                <option value="hello">Hello world</option>
                <option value="leetcode">LeetCode-style</option>
              </select>
            </Field>
            <Field label="Kind" className="lg:col-span-4">
              <div className="grid grid-cols-2 gap-2">
                <KindToggle
                  active={kind === 'sandbox'}
                  onClick={() => setKind('sandbox')}
                  icon={<BeakerIcon />}
                  label="Sandbox"
                  hint="Free-form coding"
                />
                <KindToggle
                  active={kind === 'interview'}
                  onClick={() => setKind('interview')}
                  icon={<ClipboardIcon />}
                  label="Interview"
                  hint="Question + rubric"
                />
              </div>
            </Field>
            <div className="lg:col-span-12 flex justify-end">
              <button
                className="btn-primary !py-2 !px-5"
                onClick={() => create.mutate()}
                disabled={create.isPending}
              >
                {create.isPending ? 'Creating…' : 'Create pad →'}
              </button>
            </div>
          </div>
        </section>

        <section className="space-y-3">
          <div className="flex items-end justify-between">
            <h2 className="text-base font-semibold">Your pads</h2>
            {list.data && list.data.pads.length > 0 && (
              <span className="text-xs text-subtle">
                {list.data.pads.length} pad{list.data.pads.length === 1 ? '' : 's'}
              </span>
            )}
          </div>
          {list.isLoading && <p className="text-secondary text-sm">loading…</p>}
          {list.isError && (
            <p className="text-danger text-sm">Failed to load. Try refreshing.</p>
          )}
          {list.data && list.data.pads.length === 0 && <EmptyPadsState />}
          <ul className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {list.data?.pads.map((p) => (
              <li
                key={p.id}
                className="card p-4 transition-all hover:shadow-pop hover:-translate-y-0.5 group"
              >
                <button
                  onClick={() => navigate(`/p/${p.slug}`)}
                  className="text-left w-full block space-y-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="font-medium truncate flex items-center gap-2">
                      <KindIcon kind={p.kind} />
                      {p.title}
                    </h3>
                    {presenceCount[p.id] ? (
                      <span className="chip chip-success shrink-0">
                        <span className="size-1.5 rounded-full bg-success animate-pulse" />
                        {presenceCount[p.id]} here
                      </span>
                    ) : null}
                  </div>
                  <div className="text-xs text-subtle flex items-center gap-2">
                    <span className="font-mono">{p.language}</span>
                    <span>·</span>
                    <span>{new Date(p.updatedAt).toLocaleString()}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="chip chip-accent">{p.myRole}</span>
                    <span className="chip">{p.kind}</span>
                    {p.hasPassword && <span className="chip">🔒</span>}
                    {p.autoRecord && <span className="chip">● rec</span>}
                  </div>
                </button>
                {p.myRole === 'owner' && (
                  <button
                    className="text-xs text-subtle hover:text-danger mt-3 transition-colors opacity-0 group-hover:opacity-100"
                    onClick={() => {
                      if (confirm(`Delete "${p.title}"? This cannot be undone.`)) {
                        remove.mutate(p.slug);
                      }
                    }}
                  >
                    delete pad
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      </main>
    </>
  );
}

function Field({
  label,
  children,
  className = '',
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="text-[11px] uppercase tracking-wide text-subtle">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

function KindToggle({
  active,
  onClick,
  icon,
  label,
  hint,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  hint: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-start gap-2 rounded-md border p-2 text-left transition-colors ${
        active
          ? 'border-accent/60 bg-accent/10 text-primary'
          : 'border-line bg-surface text-secondary hover:border-strong'
      }`}
    >
      <span
        className={`mt-0.5 size-7 inline-flex items-center justify-center rounded ${
          active ? 'bg-accent/20 text-accent' : 'bg-elevated text-secondary'
        }`}
      >
        {icon}
      </span>
      <span className="block">
        <span className="block text-sm font-medium">{label}</span>
        <span className="block text-[11px] text-subtle">{hint}</span>
      </span>
    </button>
  );
}

function KindIcon({ kind }: { kind: string }) {
  return (
    <span className="inline-flex size-5 items-center justify-center rounded bg-elevated text-secondary">
      {kind === 'interview' ? <ClipboardIcon /> : <BeakerIcon />}
    </span>
  );
}

function EmptyPadsState() {
  return (
    <div className="card p-10 text-center space-y-3">
      <div className="mx-auto size-12 rounded-full inline-flex items-center justify-center bg-accent/15 text-accent">
        <BeakerIcon />
      </div>
      <h3 className="font-semibold">No pads yet</h3>
      <p className="text-sm text-subtle max-w-sm mx-auto">
        Create your first pad above and share the link. Anyone with the URL can hop in by picking a
        name.
      </p>
    </div>
  );
}

function BeakerIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10 2v6.5L3 19a2 2 0 0 0 1.73 3h14.54A2 2 0 0 0 21 19l-7-10.5V2" />
      <path d="M10 2h4" />
      <path d="M6.5 14h11" />
    </svg>
  );
}
function ClipboardIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="8" y="2" width="8" height="4" rx="1" />
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
    </svg>
  );
}
