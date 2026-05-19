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
      navigate(`/?next=${encodeURIComponent(`/invite/${token}`)}`);
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
      <main className="max-w-md mx-auto px-4 py-12">
        <div className="card p-6 space-y-4 shadow-soft">
          {preview.isLoading && <div className="text-secondary text-sm">checking invite…</div>}
          {preview.error && (
            <div className="text-danger text-sm">
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
      <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-accent">
        <span className="size-1.5 rounded-full bg-accent" />
        Invitation
      </div>
      <h1 className="text-2xl font-semibold tracking-tight text-primary">You've been invited</h1>
      <div className="space-y-2 text-sm">
        <p className="text-secondary">
          Pad: <span className="font-medium text-primary">{inv.padTitle}</span>{' '}
          <code className="text-subtle text-[12px]">{inv.padSlug}</code>
        </p>
        <p className="text-secondary">
          Role: <span className="chip chip-accent">{inv.role}</span>
          {inv.emailRestricted && (
            <span className="ml-2 text-xs text-subtle">bound to invited email</span>
          )}
        </p>
        {inv.expiresAt && (
          <p className="text-xs text-subtle">
            Expires {new Date(inv.expiresAt).toLocaleString()}
          </p>
        )}
      </div>
      {err && (
        <p className="text-sm text-danger" role="alert">
          {err}
        </p>
      )}
      <button className="btn-primary w-full !py-2.5" onClick={onAccept} disabled={busy}>
        {!signedIn ? 'Sign in & join' : busy ? 'Joining…' : 'Join pad →'}
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
