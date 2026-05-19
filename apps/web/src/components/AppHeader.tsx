import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/authStore';

export function AppHeader() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  return (
    <header className="border-b border-zinc-800 bg-zinc-950/80 backdrop-blur sticky top-0 z-10">
      <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
        <Link to={user ? '/dashboard' : '/'} className="flex items-center gap-2">
          <span className="size-2 rounded-full bg-brand-400" />
          <span className="font-semibold tracking-tight">opencoder</span>
        </Link>
        <nav className="flex items-center gap-3 text-sm">
          {user ? (
            <>
              <span className="text-zinc-400 hidden sm:inline">{user.name}</span>
              <button
                onClick={async () => {
                  await logout();
                  navigate('/');
                }}
                className="btn-ghost"
              >
                Sign out
              </button>
            </>
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
