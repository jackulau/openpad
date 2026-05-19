import { Navigate, Route, Routes } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import { Landing } from './pages/Landing';

const Login = lazy(() => import('./pages/Login').then((m) => ({ default: m.Login })));
const Register = lazy(() => import('./pages/Register').then((m) => ({ default: m.Register })));
const Dashboard = lazy(() => import('./pages/Dashboard').then((m) => ({ default: m.Dashboard })));
const Pad = lazy(() => import('./pages/Pad').then((m) => ({ default: m.Pad })));
const Playback = lazy(() => import('./pages/Playback').then((m) => ({ default: m.Playback })));
const Interview = lazy(() => import('./pages/Interview').then((m) => ({ default: m.Interview })));
const InvitePage = lazy(() => import('./pages/Invite').then((m) => ({ default: m.InvitePage })));

export function App() {
  return (
    <Suspense fallback={<div className="p-8 text-zinc-400">loading…</div>}>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/p/:slug" element={<Pad />} />
        <Route path="/p/:slug/playback" element={<Playback />} />
        <Route path="/p/:slug/interview" element={<Interview />} />
        <Route path="/invite/:token" element={<InvitePage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
