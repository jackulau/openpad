import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/authStore';
import { useTheme } from '../lib/theme';
import { Logo } from './Logo';

export function AppHeader() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { theme, toggle } = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('keydown', onEsc);
    };
  }, [menuOpen]);

  return (
    <header
      className="sticky top-0 z-30 backdrop-blur-md"
      style={{
        backgroundColor: 'rgb(var(--oc-bg-page) / 0.78)',
        borderBottom: '1px solid rgb(var(--oc-border-default))',
      }}
    >
      <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
        <Link
          to={user ? '/dashboard' : '/'}
          className="flex items-center gap-2 group hover:opacity-90 transition-opacity"
          aria-label="opencoder home"
        >
          <Logo />
        </Link>
        <nav className="flex items-center gap-2 text-sm">
          <button
            className="btn-ghost !px-2"
            onClick={toggle}
            title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
            aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
          >
            {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
          </button>
          {user ? (
            <div className="relative" ref={menuRef}>
              <button
                onClick={() => setMenuOpen((o) => !o)}
                className="flex items-center gap-2 pl-1 pr-2 py-1 rounded-md hover:bg-hover transition-colors"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
              >
                <Avatar name={user.name} />
                <span className="hidden sm:inline text-secondary text-sm">{user.name}</span>
                <ChevronDownIcon />
              </button>
              {menuOpen && (
                <div
                  role="menu"
                  className="absolute right-0 mt-1 w-48 rounded-md shadow-pop overflow-hidden"
                  style={{
                    backgroundColor: 'rgb(var(--oc-bg-surface))',
                    border: '1px solid rgb(var(--oc-border-default))',
                  }}
                >
                  <MenuLink to="/dashboard" onClick={() => setMenuOpen(false)}>
                    Dashboard
                  </MenuLink>
                  <MenuLink to="/settings" onClick={() => setMenuOpen(false)}>
                    Settings
                  </MenuLink>
                  <button
                    role="menuitem"
                    className="w-full text-left px-3 py-2 text-sm hover:bg-hover text-secondary hover:text-primary"
                    onClick={async () => {
                      setMenuOpen(false);
                      await logout();
                      navigate('/');
                    }}
                  >
                    Sign out
                  </button>
                </div>
              )}
            </div>
          ) : (
            <>
              <Link to="/login" className="btn-ghost">
                Log in
              </Link>
              <Link to="/register" className="btn-primary">
                Sign up
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}

function MenuLink({
  to,
  onClick,
  children,
}: {
  to: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Link
      to={to}
      role="menuitem"
      onClick={onClick}
      className="block px-3 py-2 text-sm text-secondary hover:bg-hover hover:text-primary"
    >
      {children}
    </Link>
  );
}

function Avatar({ name }: { name: string }) {
  const initials =
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() ?? '')
      .join('') || '?';
  // Stable hue from name for visual variety without prop drilling.
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  const hue = Math.abs(hash) % 360;
  return (
    <span
      className="inline-flex items-center justify-center size-7 rounded-full text-[11px] font-semibold"
      style={{
        backgroundColor: `hsl(${hue} 65% 45%)`,
        color: 'white',
      }}
    >
      {initials}
    </span>
  );
}

function SunIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  );
}
function MoonIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}
function ChevronDownIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-subtle">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}
