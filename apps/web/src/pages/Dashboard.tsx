import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { groupedLanguages } from '@opencoder/shared';
import { AppHeader } from '../components/AppHeader';
import { padsApi } from '../lib/pads';

export function Dashboard() {
  const navigate = useNavigate();
  const qc = useQueryClient();
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
  const create = useMutation({
    mutationFn: () =>
      padsApi.create({ title: title || undefined, language: version, kind, template }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['pads'] });
      navigate(`/p/${res.pad.slug}`);
    },
  });
  const remove = useMutation({
    mutationFn: (slug: string) => padsApi.delete(slug),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pads'] }),
  });

  return (
    <>
      <AppHeader />
      <main className="max-w-6xl mx-auto p-6 space-y-8">
        <section className="card p-5 space-y-4">
          <h2 className="text-lg font-semibold">New pad</h2>
          <div className="grid sm:grid-cols-[1fr_auto_auto_auto] gap-3 items-end">
            <label className="block">
              <span className="text-xs uppercase tracking-wide text-zinc-500">Title</span>
              <input
                className="input mt-1"
                placeholder="Optional"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>
            <label className="block">
              <span className="text-xs uppercase tracking-wide text-zinc-500">Language</span>
              <select
                className="input mt-1"
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
            </label>
            {versions.length > 1 && (
              <label className="block">
                <span className="text-xs uppercase tracking-wide text-zinc-500">Version</span>
                <select
                  className="input mt-1"
                  value={version}
                  onChange={(e) => setVersion(e.target.value)}
                >
                  {versions.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.version ?? v.id}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="block">
              <span className="text-xs uppercase tracking-wide text-zinc-500">Template</span>
              <select
                className="input mt-1"
                value={template}
                onChange={(e) => setTemplate(e.target.value as 'hello' | 'leetcode')}
              >
                <option value="hello">Hello world</option>
                <option value="leetcode">LeetCode-style</option>
              </select>
            </label>
            <label className="block">
              <span className="text-xs uppercase tracking-wide text-zinc-500">Kind</span>
              <select
                className="input mt-1"
                value={kind}
                onChange={(e) => setKind(e.target.value as 'sandbox' | 'interview')}
              >
                <option value="sandbox">Sandbox</option>
                <option value="interview">Interview</option>
              </select>
            </label>
            <button
              className="btn-primary h-[42px]"
              onClick={() => create.mutate()}
              disabled={create.isPending}
            >
              {create.isPending ? 'Creating…' : 'Create pad'}
            </button>
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Your pads</h2>
          {list.isLoading && <p className="text-zinc-400 text-sm">loading…</p>}
          {list.isError && (
            <p className="text-red-400 text-sm">Failed to load. Try refreshing.</p>
          )}
          {list.data && list.data.pads.length === 0 && (
            <p className="text-zinc-500 text-sm">No pads yet — create one above.</p>
          )}
          <ul className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {list.data?.pads.map((p) => (
              <li key={p.id} className="card p-4 hover:border-zinc-700 transition-colors">
                <button
                  onClick={() => navigate(`/p/${p.slug}`)}
                  className="text-left w-full block space-y-1"
                >
                  <div className="flex items-center justify-between">
                    <h3 className="font-medium">{p.title}</h3>
                    <span className="text-[10px] uppercase tracking-wide text-zinc-500">
                      {p.kind}
                    </span>
                  </div>
                  <div className="text-xs text-zinc-500 flex items-center gap-2">
                    <span>{p.language}</span>
                    <span>·</span>
                    <span>{new Date(p.updatedAt).toLocaleString()}</span>
                  </div>
                  <div className="text-[10px] uppercase tracking-wide text-brand-400">
                    {p.myRole}
                  </div>
                </button>
                {p.myRole === 'owner' && (
                  <button
                    className="text-xs text-zinc-500 hover:text-red-400 mt-2"
                    onClick={() => {
                      if (confirm(`Delete "${p.title}"? This cannot be undone.`)) {
                        remove.mutate(p.slug);
                      }
                    }}
                  >
                    delete
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
