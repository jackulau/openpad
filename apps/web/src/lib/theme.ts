import { create } from 'zustand';

export type Theme = 'dark' | 'light';

export type EditorTheme =
  | 'opencoder-dark'
  | 'opencoder-light'
  | 'github-dark'
  | 'github-light'
  | 'monokai'
  | 'dracula'
  | 'solarized-dark'
  | 'solarized-light'
  | 'nord'
  | 'one-dark';

export const EDITOR_THEMES: ReadonlyArray<{ id: EditorTheme; label: string; mode: Theme }> = [
  { id: 'opencoder-dark', label: 'opencoder dark', mode: 'dark' },
  { id: 'opencoder-light', label: 'opencoder light', mode: 'light' },
  { id: 'github-dark', label: 'GitHub Dark', mode: 'dark' },
  { id: 'github-light', label: 'GitHub Light', mode: 'light' },
  { id: 'one-dark', label: 'One Dark', mode: 'dark' },
  { id: 'dracula', label: 'Dracula', mode: 'dark' },
  { id: 'monokai', label: 'Monokai', mode: 'dark' },
  { id: 'nord', label: 'Nord', mode: 'dark' },
  { id: 'solarized-dark', label: 'Solarized Dark', mode: 'dark' },
  { id: 'solarized-light', label: 'Solarized Light', mode: 'light' },
];

const THEME_KEY = 'oc_theme';
const EDITOR_KEY = 'oc_editor_theme';

function readInitialTheme(): Theme {
  if (typeof window === 'undefined') return 'dark';
  const stored = localStorage.getItem(THEME_KEY);
  if (stored === 'light' || stored === 'dark') return stored;
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function readInitialEditorTheme(mode: Theme): EditorTheme {
  if (typeof window === 'undefined') return mode === 'light' ? 'opencoder-light' : 'opencoder-dark';
  const stored = localStorage.getItem(EDITOR_KEY);
  if (stored && EDITOR_THEMES.some((t) => t.id === stored)) return stored as EditorTheme;
  return mode === 'light' ? 'opencoder-light' : 'opencoder-dark';
}

function applyTheme(theme: Theme): void {
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
  editorTheme: EditorTheme;
  setTheme: (t: Theme) => void;
  toggle: () => void;
  setEditorTheme: (t: EditorTheme) => void;
}

// When the user toggles app dark/light, also flip the editor theme - but only
// if they haven't picked a non-default one. Once they explicitly set an editor
// theme via Settings, EDITOR_KEY is in localStorage and we leave it alone.
function autoEditorFor(mode: Theme): EditorTheme {
  return mode === 'light' ? 'opencoder-light' : 'opencoder-dark';
}

export const useTheme = create<ThemeState>((set) => {
  const initialTheme = readInitialTheme();
  const initialEditor = readInitialEditorTheme(initialTheme);
  applyTheme(initialTheme);
  return {
    theme: initialTheme,
    editorTheme: initialEditor,
    setTheme: (t) => {
      localStorage.setItem(THEME_KEY, t);
      applyTheme(t);
      const userPicked = localStorage.getItem(EDITOR_KEY) != null;
      set(userPicked ? { theme: t } : { theme: t, editorTheme: autoEditorFor(t) });
    },
    toggle: () =>
      set((s) => {
        const next: Theme = s.theme === 'dark' ? 'light' : 'dark';
        localStorage.setItem(THEME_KEY, next);
        applyTheme(next);
        const userPicked = localStorage.getItem(EDITOR_KEY) != null;
        return userPicked
          ? { theme: next }
          : { theme: next, editorTheme: autoEditorFor(next) };
      }),
    setEditorTheme: (t) => {
      localStorage.setItem(EDITOR_KEY, t);
      set({ editorTheme: t });
    },
  };
});
