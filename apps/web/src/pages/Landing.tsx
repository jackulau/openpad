import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/authStore';
import { HttpError } from '../lib/api';
import { Logo } from '../components/Logo';

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
    <main className="landing-bg relative min-h-screen flex items-center justify-center px-6">
      <div className="relative max-w-xl text-center space-y-6 w-full">
        <div className="flex justify-center pb-2">
          <Logo size={56} withText={false} />
        </div>
        <h1 className="text-5xl font-semibold tracking-tight leading-[1.05]">
          Code together,{' '}
          <span className="text-accent">on your own port</span>.
        </h1>
        <p className="text-secondary leading-relaxed max-w-md mx-auto">
          Pick a name and start coding. No email, no password. Share the URL
          with your friends. They pick a name too and join you.
        </p>

        <form
          onSubmit={onSubmit}
          className="space-y-3 max-w-sm mx-auto pt-2"
          aria-label="Guest signup"
        >
          <label htmlFor="guest-name" className="sr-only">
            Your name
          </label>
          <input
            id="guest-name"
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
          <button
            type="submit"
            className="btn-primary w-full !py-3"
            disabled={loading || !name.trim()}
          >
            {loading ? 'Starting…' : 'Start coding →'}
          </button>
        </form>

      </div>
    </main>
  );
}
