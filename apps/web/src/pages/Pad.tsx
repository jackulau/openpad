import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { RunResult } from '@opencoder/shared';
import { LANGUAGES } from '@opencoder/shared';
import { AppHeader } from '../components/AppHeader';
import { Editor } from '../components/Editor';
import { OutputPanel } from '../components/OutputPanel';
import { padsApi } from '../lib/pads';
import { execApi } from '../lib/exec';

export function Pad() {
  const { slug = '' } = useParams<{ slug: string }>();
  const pad = useQuery({
    queryKey: ['pad', slug],
    queryFn: () => padsApi.get(slug),
    enabled: !!slug,
  });

  const [language, setLanguage] = useState('python');
  const [source, setSource] = useState('');
  const [result, setResult] = useState<RunResult | undefined>(undefined);
  const [activeFileId, setActiveFileId] = useState<string | null>(null);

  useEffect(() => {
    if (pad.data && !activeFileId) {
      const first = pad.data.files[0];
      if (first) {
        setActiveFileId(first.id);
        setLanguage(first.language);
        setSource(starterForFile(first.name));
      }
      if (pad.data.pad.language) setLanguage(pad.data.pad.language);
    }
  }, [pad.data, activeFileId]);

  const activeFile = useMemo(
    () => pad.data?.files.find((f) => f.id === activeFileId),
    [pad.data, activeFileId],
  );

  const run = useMutation({
    mutationFn: () =>
      execApi.run(slug, {
        source,
        language,
        filename: activeFile?.name,
      }),
    onSuccess: (r) => setResult(r),
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        run.mutate();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [run]);

  if (pad.isLoading) return <div className="p-8 text-zinc-400">loading…</div>;
  if (pad.error)
    return (
      <div className="p-8 text-red-400">
        Couldn't load pad. <Link to="/dashboard" className="underline">Back</Link>
      </div>
    );
  if (!pad.data) return null;

  return (
    <div className="h-screen flex flex-col">
      <AppHeader />
      <div className="border-b border-zinc-800 px-4 py-2 flex items-center gap-3">
        <h2 className="font-medium text-sm">{pad.data.pad.title}</h2>
        <span className="text-xs text-zinc-500">{slug}</span>
        <div className="ml-auto flex items-center gap-2">
          <select
            className="input !py-1 !text-sm"
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
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
            disabled={run.isPending}
          >
            {run.isPending ? 'Running…' : 'Run ⌘↵'}
          </button>
        </div>
      </div>
      <div className="flex-1 grid grid-cols-[200px_1fr_400px]">
        <aside className="border-r border-zinc-800 p-2 text-sm">
          <div className="text-xs uppercase tracking-wide text-zinc-500 px-2 mb-1">Files</div>
          {pad.data.files.map((f) => (
            <button
              key={f.id}
              onClick={() => {
                setActiveFileId(f.id);
                setLanguage(f.language);
              }}
              className={`block w-full text-left px-2 py-1 rounded ${
                f.id === activeFileId ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:bg-zinc-900'
              }`}
            >
              {f.name}
            </button>
          ))}
          <div className="text-xs uppercase tracking-wide text-zinc-500 px-2 mt-4 mb-1">
            Members
          </div>
          {pad.data.members.map((m) => (
            <div key={m.id} className="px-2 py-1 text-xs text-zinc-400">
              {m.name} <span className="text-zinc-600">· {m.role}</span>
            </div>
          ))}
        </aside>
        <main className="min-w-0">
          <Editor language={language} value={source} onChange={setSource} />
        </main>
        <section className="border-l border-zinc-800 min-w-0 flex flex-col">
          <div className="border-b border-zinc-800 px-3 py-1.5 text-xs uppercase tracking-wide text-zinc-500">
            Output
          </div>
          <OutputPanel running={run.isPending} result={result} />
        </section>
      </div>
    </div>
  );
}

function starterForFile(name: string): string {
  if (name.endsWith('.py')) return 'print("hello, friend!")\n';
  if (name.endsWith('.js')) return 'console.log("hello, friend!");\n';
  if (name.endsWith('.ts'))
    return 'const greet = (who: string) => `hello, ${who}!`;\nconsole.log(greet("friend"));\n';
  return '';
}
