import { useEffect, useState } from 'react';

interface Shortcut {
  keys: string[];
  description: string;
  scope?: string;
}

const SHORTCUTS: Shortcut[] = [
  { keys: ['?'], description: 'Open this shortcut help', scope: 'global' },
  { keys: ['⌘', '↵'], description: 'Run code', scope: 'pad' },
  { keys: ['Ctrl', '↵'], description: 'Run code (Linux/Windows)', scope: 'pad' },
  { keys: ['Esc'], description: 'Close any open modal', scope: 'global' },
  { keys: ['⌘', 'K'], description: 'Quick switch (focus pad list)', scope: 'dashboard' },
];

export function useShortcutsModal(): {
  open: boolean;
  setOpen: (v: boolean) => void;
} {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || (e.target as HTMLElement)?.isContentEditable) {
        return;
      }
      if (e.key === '?' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === 'Escape') {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return { open, setOpen };
}

export function ShortcutsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="card max-w-md w-full p-5 space-y-4"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Keyboard shortcuts"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Keyboard shortcuts</h2>
          <button className="btn-ghost !py-1" onClick={onClose}>
            Close
          </button>
        </div>
        <ul className="space-y-2 text-sm">
          {SHORTCUTS.map((s, i) => (
            <li key={i} className="flex items-center justify-between gap-3">
              <span className="text-zinc-300">{s.description}</span>
              <span className="flex items-center gap-1">
                {s.keys.map((k, j) => (
                  <kbd
                    key={j}
                    className="px-2 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-xs font-mono"
                  >
                    {k}
                  </kbd>
                ))}
              </span>
            </li>
          ))}
        </ul>
        <p className="text-xs text-zinc-500">
          Press <kbd className="px-1 bg-zinc-800 rounded">?</kbd> anywhere to toggle this panel.
        </p>
      </div>
    </div>
  );
}
