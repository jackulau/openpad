import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { invitesApi } from '../lib/invites';
import { passwordApi } from '../lib/passwords';
import { HttpError } from '../lib/api';
import { copyToClipboard, useToasts } from '../lib/toast';

interface Props {
  slug: string;
  onClose: () => void;
}

export function InvitesPanel({ slug, onClose }: Props) {
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: ['invites', slug],
    queryFn: () => invitesApi.list(slug),
  });

  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'collaborator' | 'viewer' | 'candidate'>('collaborator');
  const [err, setErr] = useState<string | null>(null);

  const refresh = () => qc.invalidateQueries({ queryKey: ['invites', slug] });

  const createEmail = useMutation({
    mutationFn: () =>
      invitesApi.create(slug, { email: email || undefined, role }),
    onSuccess: () => {
      setEmail('');
      setErr(null);
      refresh();
    },
    onError: (e) => setErr(e instanceof HttpError ? e.error : 'Failed'),
  });
  const share = useMutation({
    mutationFn: () => invitesApi.share(slug, { role }),
    onSuccess: () => refresh(),
    onError: (e) => setErr(e instanceof HttpError ? e.error : 'Failed'),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => invitesApi.revoke(slug, id),
    onSuccess: () => refresh(),
  });

  return (
    <div className="fixed inset-0 bg-black/60 z-40 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="card max-w-2xl w-full p-5 space-y-4 max-h-[80vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Share this pad</h2>
          <button className="btn-ghost" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="grid sm:grid-cols-[1fr_auto_auto_auto] gap-2">
          <input
            className="input"
            placeholder="friend@example.com (optional)"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            type="email"
          />
          <select
            className="input"
            value={role}
            onChange={(e) => setRole(e.target.value as typeof role)}
          >
            <option value="collaborator">Collaborator</option>
            <option value="viewer">Viewer</option>
            <option value="candidate">Candidate</option>
          </select>
          <button
            className="btn-primary"
            onClick={() => createEmail.mutate()}
            disabled={createEmail.isPending}
          >
            Create invite
          </button>
          <button
            className="btn-secondary"
            onClick={() => share.mutate()}
            disabled={share.isPending}
          >
            Share link
          </button>
        </div>
        {err && <div className="text-xs text-danger">{err}</div>}

        <PasswordSection slug={slug} />

        <div className="space-y-2">
          <h3 className="text-xs uppercase tracking-wide text-subtle">Active invites</h3>
          {list.isLoading && <div className="text-subtle text-sm">loading…</div>}
          {list.data?.invites.length === 0 && (
            <div className="text-subtle text-sm">No invites yet.</div>
          )}
          <ul className="space-y-2">
            {list.data?.invites.map((inv) => (
              <li
                key={inv.id}
                className="flex items-center justify-between gap-3 p-3 border border-line rounded"
              >
                <div className="min-w-0">
                  <div className="text-sm flex items-center gap-2">
                    <span className="font-medium">{inv.email ?? 'Anyone with link'}</span>
                    <span className="text-xs text-accent">{inv.role}</span>
                    {inv.usedAt && <span className="text-xs text-subtle">used</span>}
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <input
                      readOnly
                      className="input !text-xs flex-1"
                      value={inv.url}
                      onFocus={(e) => e.currentTarget.select()}
                    />
                    <CopyButton text={inv.url} />
                  </div>
                </div>
                <button
                  className="btn-ghost text-secondary hover:text-danger"
                  onClick={() => revoke.mutate(inv.id)}
                  title="Revoke"
                >
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const push = useToasts((s) => s.push);
  return (
    <button
      className="btn-secondary !py-1 !text-xs"
      onClick={async () => {
        const ok = await copyToClipboard(text);
        push(ok ? 'Link copied' : 'Copy failed', ok ? 'success' : 'error');
      }}
      title="Copy"
    >
      Copy
    </button>
  );
}

function PasswordSection({ slug }: { slug: string }) {
  const qc = useQueryClient();
  const preview = useQuery({
    queryKey: ['pad-preview', slug],
    queryFn: () => passwordApi.preview(slug),
  });
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'collaborator' | 'viewer' | 'candidate'>('collaborator');
  const [err, setErr] = useState<string | null>(null);
  const set = useMutation({
    mutationFn: () => passwordApi.set(slug, password, role),
    onSuccess: () => {
      setPassword('');
      setErr(null);
      qc.invalidateQueries({ queryKey: ['pad-preview', slug] });
    },
    onError: (e) => setErr(e instanceof HttpError ? e.error : 'Failed'),
  });
  const clear = useMutation({
    mutationFn: () => passwordApi.set(slug, null),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pad-preview', slug] }),
  });
  return (
    <div className="space-y-2 border-t border-line pt-3">
      <h3 className="text-xs uppercase tracking-wide text-subtle">Password gate</h3>
      <p className="text-xs text-subtle">
        Optional. Anyone with the link can join after entering this password —{' '}
        {preview.data?.hasPassword ? 'currently enabled.' : 'currently disabled.'}
      </p>
      <div className="grid sm:grid-cols-[1fr_auto_auto_auto] gap-2">
        <input
          className="input"
          type="password"
          placeholder={preview.data?.hasPassword ? 'change password…' : 'set a password'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <select
          className="input"
          value={role}
          onChange={(e) => setRole(e.target.value as typeof role)}
        >
          <option value="collaborator">Collaborator</option>
          <option value="viewer">Viewer</option>
          <option value="candidate">Candidate</option>
        </select>
        <button
          className="btn-primary"
          onClick={() => password && set.mutate()}
          disabled={set.isPending || !password}
        >
          Save
        </button>
        {preview.data?.hasPassword && (
          <button
            className="btn-ghost text-danger"
            onClick={() => clear.mutate()}
            disabled={clear.isPending}
          >
            Clear
          </button>
        )}
      </div>
      {err && <div className="text-xs text-danger">{err}</div>}
    </div>
  );
}
