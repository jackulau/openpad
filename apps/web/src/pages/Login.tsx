import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AuthLayout } from '../components/AuthLayout';
import { useAuth } from '../lib/authStore';
import { HttpError } from '../lib/api';

export function Login() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { login, loading } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    try {
      await login(email, password);
      navigate(params.get('next') ?? '/dashboard', { replace: true });
    } catch (e) {
      if (e instanceof HttpError) {
        setErr(e.error === 'invalid_credentials' ? 'Email or password is incorrect.' : e.error);
      } else {
        setErr('Network error');
      }
    }
  };

  return (
    <AuthLayout title="Log in" subtitle="Welcome back to opencoder.">
      <form onSubmit={onSubmit} className="space-y-4">
        <label className="block">
          <span className="text-sm text-secondary">Email</span>
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
          <span className="text-sm text-secondary">Password</span>
          <input
            type="password"
            autoComplete="current-password"
            required
            minLength={8}
            className="input mt-1"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {err && (
          <div className="text-sm text-danger" role="alert">
            {err}
          </div>
        )}
        <button type="submit" disabled={loading} className="btn-primary w-full">
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
      <div className="text-sm text-secondary">
        New here?{' '}
        <Link to="/register" className="text-accent hover:underline">
          Create an account
        </Link>
      </div>
    </AuthLayout>
  );
}
