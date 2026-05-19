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
    return <Navigate to={`/login?next=${encodeURIComponent(location.pathname)}`} replace />;
  }
  return <>{children}</>;
}
