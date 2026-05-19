import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../lib/authStore';
import { useTheme } from '../lib/theme';
import { padsApi } from '../lib/pads';

interface Action {
  id: string;
  title: string;
  hint?: string;
  group: 'navigate' | 'pad' | 'theme' | 'account';
  run: () => void | Promise<void>;
}

// Global ⌘K / Ctrl+K palette: jump to pad, create pad, toggle theme, settings,
// sign out. Lazy-loads pad list when opened so the network call is paid only
// when needed.
export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const inputRef = useRef<HTMLInputElement>(null);

  // Global keybinding (⌘K / Ctrl+K).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === 'Escape' && open) {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // Reset state + focus input when opened.
  useEffect(() => {
    if (open) {
      setQuery('');
      setCursor(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  const pads = useQuery({
    queryKey: ['palette-pads'],
    queryFn: () => padsApi.list(),
    enabled: open && !!user,
    staleTime: 30_000,
  });

  const actions: Action[] = useMemo(() => {
    const acts: Action[] = [];
    if (user) {
      acts.push({
        id: 'nav-dashboard',
        title: 'Go to dashboard',
        hint: 'Pad list + create',
        group: 'navigate',
        run: () => navigate('/dashboard'),
      });
      acts.push({
        id: 'pad-new',
        title: 'New pad',
        hint: 'Default Python sandbox',
        group: 'pad',
        run: async () => {
          const r = await padsApi.create({ language: 'python312', kind: 'sandbox', template: 'hello' });
          navigate(`/p/${r.pad.slug}`);
        },
      });
      acts.push({
        id: 'nav-settings',
        title: 'Open settings',
        group: 'account',
        run: () => navigate('/settings'),
      });
      acts.push({
        id: 'account-signout',
        title: 'Sign out',
        group: 'account',
        run: async () => {
          await logout();
          navigate('/');
        },
      });
    }
    acts.push({
      id: 'theme-toggle',
      title: `Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`,
      hint: `Currently: ${theme}`,
      group: 'theme',
      run: () => toggle(),
    });
    for (const pad of pads.data?.pads ?? []) {
      acts.push({
        id: `pad-${pad.id}`,
        title: pad.title,
        hint: `${pad.language} · ${pad.kind} · /p/${pad.slug}`,
        group: 'pad',
        run: () => navigate(`/p/${pad.slug}`),
      });
    }
    return acts;
  }, [user, theme, navigate, logout, toggle, pads.data]);

  const filtered = useMemo(() => {
    if (!query) return actions;
    const q = query.toLowerCase();
    return actions.filter(
      (a) => a.title.toLowerCase().includes(q) || (a.hint ?? '').toLowerCase().includes(q),
    );
  }, [actions, query]);

  // Keep the cursor in range as the result list changes.
  useEffect(() => {
    if (cursor >= filtered.length) setCursor(0);
  }, [filtered.length, cursor]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor((c) => Math.min(filtered.length - 1, c + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor((c) => Math.max(0, c - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const a = filtered[cursor];
      if (a) {
        void a.run();
        setOpen(false);
      }
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh] px-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      style={{ backgroundColor: 'rgb(0 0 0 / 0.35)' }}
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-xl shadow-pop"
        style={{
          backgroundColor: 'rgb(var(--oc-bg-surface))',
          border: '1px solid rgb(var(--oc-border-default))',
        }}
      >
        <div className="flex items-center gap-2 px-3 py-2 border-b border-line">
          <SearchIcon />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Jump to pad, run command…"
            className="flex-1 bg-transparent outline-none text-sm text-primary placeholder:text-subtle"
          />
          <kbd className="kbd">esc</kbd>
        </div>
        <ul className="max-h-80 overflow-y-auto py-1">
          {filtered.length === 0 && (
            <li className="px-4 py-6 text-center text-subtle text-sm">No results.</li>
          )}
          {filtered.map((a, i) => (
            <li key={a.id}>
              <button
                type="button"
                onMouseEnter={() => setCursor(i)}
                onClick={() => {
                  void a.run();
                  setOpen(false);
                }}
                className={`w-full text-left px-3 py-2 flex items-center gap-3 ${
                  i === cursor ? 'bg-hover' : ''
                }`}
              >
                <GroupIcon group={a.group} />
                <span className="flex-1 min-w-0">
                  <span className="block text-sm text-primary truncate">{a.title}</span>
                  {a.hint && (
                    <span className="block text-xs text-subtle truncate">{a.hint}</span>
                  )}
                </span>
                {i === cursor && <kbd className="kbd">↵</kbd>}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function GroupIcon({ group }: { group: Action['group'] }) {
  const cls = 'size-6 rounded inline-flex items-center justify-center bg-elevated text-secondary';
  if (group === 'pad') return <span className={cls}>P</span>;
  if (group === 'navigate') return <span className={cls}>→</span>;
  if (group === 'theme') return <span className={cls}>◐</span>;
  return <span className={cls}>○</span>;
}

function SearchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-subtle">
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
    </svg>
  );
}
