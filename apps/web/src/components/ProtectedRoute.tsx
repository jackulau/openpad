import { useEffect } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuth } from '../lib/authStore';

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, hydrated, hydrate } = useAuth();
  const location = useLocation();

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  if (!hydrated) {
    return <div className="p-8 text-secondary">loading…</div>;
  }
  if (!user) {
    // No /login page anymore - bounce back to landing where the user picks a name.
    return <Navigate to={`/?next=${encodeURIComponent(location.pathname)}`} replace />;
  }
  return <>{children}</>;
}
