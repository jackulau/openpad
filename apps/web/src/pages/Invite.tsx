import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AppHeader } from '../components/AppHeader';
import { invitesApi, type InvitePreview } from '../lib/invites';
import { useAuth } from '../lib/authStore';
import { HttpError } from '../lib/api';

export function InvitePage() {
  const { token = '' } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { user, hydrated, hydrate } = useAuth();
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!hydrated) {
    void hydrate();
  }

  const preview = useQuery({
    queryKey: ['invite', token],
    queryFn: () => invitesApi.preview(token),
  });

  const accept = async () => {
    if (!user) {
      navigate(`/login?next=${encodeURIComponent(`/invite/${token}`)}`);
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const res = await invitesApi.accept(token);
      navigate(`/p/${res.slug}`);
    } catch (e) {
      if (e instanceof HttpError) setErr(prettyError(e.error));
      else setErr('Network error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <AppHeader />
      <main className="max-w-md mx-auto p-6">
        <div className="card p-6 space-y-4">
          {preview.isLoading && <div className="text-zinc-400 text-sm">checking invite…</div>}
          {preview.error && (
            <div className="text-red-400 text-sm">
              {preview.error instanceof HttpError ? prettyError(preview.error.error) : 'Failed'}
            </div>
          )}
          {preview.data && (
            <InviteCard inv={preview.data.invite} onAccept={accept} busy={busy} err={err} signedIn={!!user} />
          )}
        </div>
      </main>
    </>
  );
}

function InviteCard({
  inv,
  onAccept,
  busy,
  err,
  signedIn,
}: {
  inv: InvitePreview;
  onAccept: () => void;
  busy: boolean;
  err: string | null;
  signedIn: boolean;
}) {
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">You've been invited</h1>
      <p className="text-sm text-zinc-300">
        Pad: <span className="font-medium">{inv.padTitle}</span> (
        <code className="text-zinc-500">{inv.padSlug}</code>)
      </p>
      <p className="text-sm text-zinc-400">
        Role: <span className="text-brand-400">{inv.role}</span>
        {inv.emailRestricted && ' · bound to invited email'}
      </p>
      {inv.expiresAt && (
        <p className="text-xs text-zinc-500">
          Expires {new Date(inv.expiresAt).toLocaleString()}
        </p>
      )}
      {err && <p className="text-sm text-red-400" role="alert">{err}</p>}
      <button className="btn-primary w-full" onClick={onAccept} disabled={busy}>
        {!signedIn ? 'Sign in & join' : busy ? 'Joining…' : 'Join pad'}
      </button>
    </div>
  );
}

function prettyError(e: string): string {
  switch (e) {
    case 'not_found':
      return 'This invite is invalid or no longer exists.';
    case 'expired':
      return 'This invite has expired. Ask the owner for a new one.';
    case 'already_used':
      return 'This invite was already used.';
    case 'wrong_email':
      return 'This invite was issued for a different email address.';
    default:
      return e;
  }
}
