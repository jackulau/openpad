import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AuthLayout } from '../components/AuthLayout';
import { useAuth } from '../lib/authStore';
import { HttpError } from '../lib/api';

export function Register() {
  const navigate = useNavigate();
  const { register, loading } = useAuth();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    try {
      await register(email, name, password);
      navigate('/dashboard', { replace: true });
    } catch (e) {
      if (e instanceof HttpError) {
        setErr(
          e.error === 'email_taken'
            ? 'That email is already registered.'
            : e.error === 'invalid_input'
              ? 'Please check your inputs (password must be at least 8 characters).'
              : e.error,
        );
      } else {
        setErr('Network error');
      }
    }
  };

  return (
    <AuthLayout
      title="Create your account"
      subtitle="Self-hosted collaborative coding for friends."
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <label className="block">
          <span className="text-sm text-zinc-300">Display name</span>
          <input
            type="text"
            autoComplete="nickname"
            required
            minLength={1}
            maxLength={80}
            className="input mt-1"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="block">
          <span className="text-sm text-zinc-300">Email</span>
          <input
            type="email"
            autoComplete="email"
            required
            className="input mt-1"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label className="block">
          <span className="text-sm text-zinc-300">Password</span>
          <input
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            className="input mt-1"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <span className="text-xs text-zinc-500 mt-1 block">At least 8 characters.</span>
        </label>
        {err && (
          <div className="text-sm text-red-400" role="alert">
            {err}
          </div>
        )}
        <button type="submit" disabled={loading} className="btn-primary w-full">
          {loading ? 'Creating…' : 'Create account'}
        </button>
      </form>
      <div className="text-sm text-zinc-400">
        Already have one?{' '}
        <Link to="/login" className="text-brand-400 hover:underline">
          Log in
        </Link>
      </div>
    </AuthLayout>
  );
}
