import { Navigate, Route, Routes } from 'react-router-dom';
import { lazy, Suspense, useEffect } from 'react';
import { Landing } from './pages/Landing';
import { ProtectedRoute } from './components/ProtectedRoute';
import { CommandPalette } from './components/CommandPalette';
import { useAuth } from './lib/authStore';

const Dashboard = lazy(() => import('./pages/Dashboard').then((m) => ({ default: m.Dashboard })));
const Pad = lazy(() => import('./pages/Pad').then((m) => ({ default: m.Pad })));
const Playback = lazy(() => import('./pages/Playback').then((m) => ({ default: m.Playback })));
const Interview = lazy(() => import('./pages/Interview').then((m) => ({ default: m.Interview })));
const InvitePage = lazy(() => import('./pages/Invite').then((m) => ({ default: m.InvitePage })));
const Settings = lazy(() => import('./pages/Settings').then((m) => ({ default: m.Settings })));

export function App() {
  const hydrate = useAuth((s) => s.hydrate);
  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  return (
    <Suspense fallback={<div className="p-8 text-secondary">loading…</div>}>
      <CommandPalette />
      <Routes>
        <Route path="/" element={<Landing />} />
        {/* Legacy auth routes redirect to landing - only /guest auth exists now. */}
        <Route path="/login" element={<Navigate to="/" replace />} />
        <Route path="/register" element={<Navigate to="/" replace />} />
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <Dashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/p/:slug"
          element={
            <ProtectedRoute>
              <Pad />
            </ProtectedRoute>
          }
        />
        <Route
          path="/p/:slug/playback"
          element={
            <ProtectedRoute>
              <Playback />
            </ProtectedRoute>
          }
        />
        <Route
          path="/p/:slug/interview"
          element={
            <ProtectedRoute>
              <Interview />
            </ProtectedRoute>
          }
        />
        <Route path="/invite/:token" element={<InvitePage />} />
        <Route
          path="/settings"
          element={
            <ProtectedRoute>
              <Settings />
            </ProtectedRoute>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
