import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/authStore';
import { HttpError } from '../lib/api';

export function Landing() {
  const navigate = useNavigate();
  const { guest, loading } = useAuth();
  const [name, setName] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    try {
      await guest(name.trim());
      navigate('/dashboard');
    } catch (e) {
      setErr(e instanceof HttpError ? e.error : 'Network error');
    }
  };

  return (
    <main className="min-h-screen flex items-center justify-center px-6">
      <div className="max-w-xl text-center space-y-6 w-full">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-surface border border-line text-xs text-secondary">
          <span className="size-1.5 rounded-full bg-accent animate-pulse" />
          self-hosted · open source
        </div>
        <h1 className="text-5xl font-semibold tracking-tight">
          Code together, <span className="text-accent">on your own port</span>.
        </h1>
        <p className="text-secondary leading-relaxed">
          Pick a name and start coding. No email, no password. Share the URL with your
          friends — they pick a name too and join you.
        </p>

        <form onSubmit={onSubmit} className="space-y-3 max-w-sm mx-auto pt-2">
          <input
            autoFocus
            required
            minLength={1}
            maxLength={80}
            className="input text-center !text-lg !py-3"
            placeholder="your name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          {err && (
            <div className="text-sm text-danger" role="alert">
              {err}
            </div>
          )}
          <button type="submit" className="btn-primary w-full !py-3" disabled={loading || !name.trim()}>
            {loading ? 'Starting…' : 'Start coding →'}
          </button>
        </form>

        <div className="text-xs text-subtle pt-4 flex items-center justify-center gap-3">
          <span>Want a recoverable account?</span>
          <Link to="/register" className="underline hover:text-secondary">
            Sign up with email
          </Link>
          <span>·</span>
          <Link to="/login" className="underline hover:text-secondary">
            Log in
          </Link>
        </div>
      </div>
    </main>
  );
}
