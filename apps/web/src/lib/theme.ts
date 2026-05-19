import { create } from 'zustand';

export type Theme = 'dark' | 'light';

const STORAGE_KEY = 'oc_theme';

function readInitial(): Theme {
  if (typeof window === 'undefined') return 'dark';
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === 'light' || stored === 'dark') return stored;
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function apply(theme: Theme): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (theme === 'dark') {
    root.classList.add('dark');
    root.classList.remove('light');
  } else {
    root.classList.add('light');
    root.classList.remove('dark');
  }
}

interface ThemeState {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggle: () => void;
}

export const useTheme = create<ThemeState>((set) => {
  const initial = readInitial();
  apply(initial);
  return {
    theme: initial,
    setTheme: (t) => {
      localStorage.setItem(STORAGE_KEY, t);
      apply(t);
      set({ theme: t });
    },
    toggle: () =>
      set((s) => {
        const next: Theme = s.theme === 'dark' ? 'light' : 'dark';
        localStorage.setItem(STORAGE_KEY, next);
        apply(next);
        return { theme: next };
      }),
  };
});
