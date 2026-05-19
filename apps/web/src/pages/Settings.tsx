import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { AppHeader } from '../components/AppHeader';
import { useAuth } from '../lib/authStore';
import { settingsApi } from '../lib/settings';
import { setToken, HttpError } from '../lib/api';
import { useToasts } from '../lib/toast';
import { useTheme } from '../lib/theme';

export function Settings() {
  const { user, hydrate, logout } = useAuth();
  const navigate = useNavigate();
  const push = useToasts((s) => s.push);
  const { theme, setTheme } = useTheme();

  const [name, setName] = useState(user?.name ?? '');
  const [confirmText, setConfirmText] = useState('');

  const saveName = useMutation({
    mutationFn: () => settingsApi.patchMe({ name }),
    onSuccess: async () => {
      push('Name updated', 'success');
      await hydrate();
    },
    onError: (e) => push(e instanceof HttpError ? e.error : 'Failed', 'error'),
  });

  const deleteAcc = useMutation({
    mutationFn: () => settingsApi.deleteMe({ confirm: 'DELETE' }),
    onSuccess: async () => {
      setToken(null);
      await logout().catch(() => null);
      navigate('/');
    },
    onError: (e) => push(e instanceof HttpError ? e.error : 'Failed', 'error'),
  });

  if (!user) {
    return (
      <>
        <AppHeader />
        <main className="p-8 text-secondary">Not signed in.</main>
      </>
    );
  }

  return (
    <>
      <AppHeader />
      <main className="max-w-2xl mx-auto p-6 space-y-6">
        <h1 className="text-2xl font-semibold">Account settings</h1>

        <section className="card p-5 space-y-4">
          <h2 className="text-lg font-semibold">Profile</h2>
          <form
            className="space-y-3"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              saveName.mutate();
            }}
          >
            <label className="block">
              <span className="text-sm text-secondary">Display name</span>
              <input
                className="input mt-1"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={80}
                required
              />
            </label>
            <button className="btn-primary" disabled={!name || saveName.isPending}>
              Save name
            </button>
          </form>
          <p className="text-xs text-subtle">
            No email or password — opencoder uses name-only signup. Your token lives in this browser only.
          </p>
        </section>

        <section className="card p-5 space-y-4">
          <h2 className="text-lg font-semibold">Theme</h2>
          <div className="flex items-center gap-2">
            <button
              className={`btn-secondary ${theme === 'dark' ? 'ring-2 ring-brand-400' : ''}`}
              onClick={() => setTheme('dark')}
            >
              ☾ Dark
            </button>
            <button
              className={`btn-secondary ${theme === 'light' ? 'ring-2 ring-brand-400' : ''}`}
              onClick={() => setTheme('light')}
            >
              ☀ Light
            </button>
          </div>
        </section>

        <section className="card p-5 space-y-4 border-red-700/40">
          <h2 className="text-lg font-semibold text-red-300">Danger zone</h2>
          <p className="text-sm text-secondary">
            Deleting your account removes all pads you own. Pads you only collaborated on are kept.
          </p>
          <form
            className="space-y-3"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              if (confirmText === 'DELETE' && confirm('Permanently delete this account?')) {
                deleteAcc.mutate();
              }
            }}
          >
            <label className="block">
              <span className="text-sm text-secondary">
                Type <code>DELETE</code> to confirm
              </span>
              <input
                className="input mt-1"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder="DELETE"
              />
            </label>
            <button
              className="btn bg-red-600 hover:bg-red-500 text-white"
              disabled={confirmText !== 'DELETE' || deleteAcc.isPending}
            >
              {deleteAcc.isPending ? 'Deleting…' : 'Delete account'}
            </button>
          </form>
        </section>
      </main>
    </>
  );
}
