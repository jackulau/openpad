import { Link } from 'react-router-dom';

export function Landing() {
  return (
    <main className="min-h-screen flex items-center justify-center px-6">
      <div className="max-w-2xl text-center space-y-6">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-zinc-900 border border-zinc-800 text-xs text-zinc-400">
          <span className="size-1.5 rounded-full bg-brand-400 animate-pulse" />
          self-hosted · open source
        </div>
        <h1 className="text-5xl font-semibold tracking-tight">
          Code together, <span className="text-brand-400">on your own port</span>.
        </h1>
        <p className="text-zinc-400 leading-relaxed">
          opencoder is a self-hosted collaborative coding pad — multi-language IDE, terminal, code
          playback, and interview rooms. Run it on your machine; invite friends to your port.
        </p>
        <div className="flex items-center justify-center gap-3 pt-2">
          <Link to="/register" className="btn-primary">
            Create account
          </Link>
          <Link to="/login" className="btn-secondary">
            Log in
          </Link>
        </div>
      </div>
    </main>
  );
}
