import { beforeEach, describe, expect, it, vi } from 'vitest';

// jsdom lacks matchMedia, which theme.ts touches at module load.
vi.stubGlobal('matchMedia', (q: string) => ({
  matches: false,
  media: q,
  onchange: null,
  addListener: () => {},
  removeListener: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => false,
}));

const THEME_KEY = 'oc_theme';
const EDITOR_KEY = 'oc_editor_theme';

const { useTheme } = await import('./theme');

beforeEach(() => {
  localStorage.removeItem(THEME_KEY);
  localStorage.removeItem(EDITOR_KEY);
  useTheme.setState({ theme: 'dark', editorTheme: 'opencoder-dark' });
});

describe('useTheme - auto-sync editor with app theme', () => {
  it('toggle flips both theme and editorTheme when user has not picked', () => {
    useTheme.setState({ theme: 'dark', editorTheme: 'opencoder-dark' });
    useTheme.getState().toggle();
    const s = useTheme.getState();
    expect(s.theme).toBe('light');
    expect(s.editorTheme).toBe('opencoder-light');
  });

  it('setTheme flips both when user has not picked', () => {
    useTheme.setState({ theme: 'dark', editorTheme: 'opencoder-dark' });
    useTheme.getState().setTheme('light');
    const s = useTheme.getState();
    expect(s.theme).toBe('light');
    expect(s.editorTheme).toBe('opencoder-light');
  });

  it('toggle leaves editorTheme alone once user has explicitly picked', () => {
    useTheme.getState().setEditorTheme('dracula');
    useTheme.getState().toggle();
    const s = useTheme.getState();
    expect(s.theme).toBe('light');
    expect(s.editorTheme).toBe('dracula');
  });

  it('setTheme leaves editorTheme alone once user has explicitly picked', () => {
    useTheme.getState().setEditorTheme('monokai');
    useTheme.getState().setTheme('light');
    const s = useTheme.getState();
    expect(s.theme).toBe('light');
    expect(s.editorTheme).toBe('monokai');
  });
});
