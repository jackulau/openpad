import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { invitesApi, membersApi } from '../lib/invites';
import { padsApi } from '../lib/pads';
import { useToasts } from '../lib/toast';
import { HttpError } from '../lib/api';

interface Props {
  slug: string;
  myUserId: string | null;
  myRole: string;
}

type Role = 'owner' | 'collaborator' | 'viewer' | 'candidate';

// Side-panel: who's in this pad, their role, and (for the owner) the controls
// to invite more people, change someone's role, or kick them. Non-owners can
// still view the roster and Leave the pad voluntarily.
export function MembersPanel({ slug, myUserId, myRole }: Props) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const push = useToasts((s) => s.push);
  const pad = useQuery({ queryKey: ['pad', slug], queryFn: () => padsApi.get(slug) });
  const invites = useQuery({
    queryKey: ['invites', slug],
    queryFn: () => invitesApi.list(slug),
    enabled: myRole === 'owner',
  });

  const isOwner = myRole === 'owner';

  const changeRole = useMutation({
    mutationFn: ({ memberId, role }: { memberId: string; role: Role }) =>
      membersApi.changeRole(slug, memberId, role as Exclude<Role, 'owner'>),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pad', slug] });
      push('Role updated', 'success');
    },
    onError: (e) => push(e instanceof HttpError ? e.error : 'Failed', 'error'),
  });
  const kick = useMutation({
    mutationFn: (memberId: string) => membersApi.kick(slug, memberId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pad', slug] });
      push('Member removed', 'success');
    },
    onError: (e) => push(e instanceof HttpError ? e.error : 'Failed', 'error'),
  });
  const leave = useMutation({
    mutationFn: () => membersApi.leave(slug),
    onSuccess: () => {
      push('You left the pad', 'success');
      navigate('/dashboard');
    },
    onError: (e) => push(e instanceof HttpError ? e.error : 'Failed', 'error'),
  });

  const members = pad.data?.members ?? [];

  return (
    <div className="h-full flex flex-col overflow-y-auto">
      <div className="px-4 py-3 border-b border-line">
        <h2 className="font-semibold text-sm">People</h2>
        <p className="text-xs text-subtle mt-0.5">
          {members.length} member{members.length === 1 ? '' : 's'}
        </p>
      </div>

      <ul className="px-2 py-2 space-y-1">
        {members.map((m) => (
          <MemberRow
            key={m.id}
            member={m}
            isMe={m.userId === myUserId}
            canManage={isOwner && m.role !== 'owner'}
            onChangeRole={(role) => changeRole.mutate({ memberId: m.id, role })}
            onKick={() => {
              if (confirm(`Remove ${m.name} from this pad?`)) kick.mutate(m.id);
            }}
          />
        ))}
      </ul>

      {!isOwner && myUserId && (
        <div className="mt-auto px-4 py-3 border-t border-line">
          <button
            className="btn-secondary w-full !text-sm !py-1.5"
            onClick={() => {
              if (confirm('Leave this pad? You will need a new invite to come back.')) {
                leave.mutate();
              }
            }}
            disabled={leave.isPending}
          >
            {leave.isPending ? 'Leaving…' : 'Leave pad'}
          </button>
        </div>
      )}

      {isOwner && (
        <>
          <div className="border-t border-line">
            <InviteSection slug={slug} />
          </div>
          {invites.data && invites.data.invites.length > 0 && (
            <div className="border-t border-line px-3 py-3 space-y-2">
              <h3 className="text-xs uppercase tracking-wide text-subtle">
                Pending invites
              </h3>
              {invites.data.invites.map((inv) => (
                <PendingInvite
                  key={inv.id}
                  inv={inv}
                  onRevoke={async () => {
                    await invitesApi.revoke(slug, inv.id);
                    qc.invalidateQueries({ queryKey: ['invites', slug] });
                  }}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function MemberRow({
  member: m,
  isMe,
  canManage,
  onChangeRole,
  onKick,
}: {
  member: { id: string; userId: string; name: string; email: string; role: string };
  isMe: boolean;
  canManage: boolean;
  onChangeRole: (role: Role) => void;
  onKick: () => void;
}) {
  return (
    <li className="flex items-center gap-3 px-2 py-2 rounded hover:bg-hover/40 group">
      <Avatar name={m.name} />
      <div className="flex-1 min-w-0">
        <div className="text-sm text-primary truncate">
          {m.name}
          {isMe && <span className="text-subtle ml-1.5 text-xs">(you)</span>}
        </div>
        <div className="text-xs text-subtle truncate">{m.email}</div>
      </div>
      {canManage ? (
        <select
          value={m.role}
          onChange={(e) => onChangeRole(e.target.value as Role)}
          className="input !py-1 !text-xs !w-auto !pl-2"
        >
          <option value="collaborator">collaborator</option>
          <option value="viewer">viewer</option>
          <option value="candidate">candidate</option>
        </select>
      ) : (
        <span className="chip text-[10px]">{m.role}</span>
      )}
      {canManage && (
        <button
          onClick={onKick}
          className="text-subtle hover:text-danger opacity-0 group-hover:opacity-100 transition-opacity"
          title="Remove from pad"
          aria-label={`Remove ${m.name}`}
        >
          <KickIcon />
        </button>
      )}
    </li>
  );
}

function InviteSection({ slug }: { slug: string }) {
  const qc = useQueryClient();
  const push = useToasts((s) => s.push);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('collaborator');

  const create = useMutation({
    mutationFn: () => invitesApi.create(slug, { email: email || undefined, role }),
    onSuccess: async (r) => {
      qc.invalidateQueries({ queryKey: ['invites', slug] });
      try {
        await navigator.clipboard.writeText(r.invite.url);
        push('Invite link copied to clipboard', 'success');
      } catch {
        push(`Invite created: ${r.invite.url}`, 'info');
      }
      setEmail('');
    },
    onError: (e) => push(e instanceof HttpError ? e.error : 'Failed', 'error'),
  });

  return (
    <div className="px-3 py-3 space-y-2">
      <h3 className="text-xs uppercase tracking-wide text-subtle">Invite someone</h3>
      <input
        className="input !text-sm"
        placeholder="email (optional)"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <div className="flex gap-2">
        <select
          className="input !py-1.5 !text-sm flex-1"
          value={role}
          onChange={(e) => setRole(e.target.value as Role)}
        >
          <option value="collaborator">collaborator</option>
          <option value="viewer">viewer</option>
          <option value="candidate">candidate</option>
        </select>
        <button
          className="btn-primary !py-1.5 !text-sm"
          onClick={() => create.mutate()}
          disabled={create.isPending}
        >
          {create.isPending ? '…' : 'Create link'}
        </button>
      </div>
    </div>
  );
}

function PendingInvite({
  inv,
  onRevoke,
}: {
  inv: { id: string; email: string | null; role: string; url: string };
  onRevoke: () => void;
}) {
  const push = useToasts((s) => s.push);
  return (
    <div className="rounded border border-line bg-elevated/40 p-2 text-xs space-y-1">
      <div className="flex items-center justify-between gap-2">
        <span className="text-primary truncate">{inv.email ?? 'any email'}</span>
        <span className="chip text-[10px]">{inv.role}</span>
      </div>
      <div className="flex items-center gap-1">
        <button
          className="text-accent hover:underline"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(inv.url);
              push('Link copied', 'success');
            } catch {
              push(inv.url, 'info');
            }
          }}
        >
          Copy link
        </button>
        <button className="ml-auto text-subtle hover:text-danger" onClick={onRevoke}>
          Revoke
        </button>
      </div>
    </div>
  );
}

function Avatar({ name }: { name: string }) {
  const initials =
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() ?? '')
      .join('') || '?';
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  const hue = Math.abs(hash) % 360;
  return (
    <span
      className="inline-flex items-center justify-center size-7 rounded-full text-[11px] font-semibold text-white shrink-0"
      style={{ backgroundColor: `hsl(${hue} 65% 45%)` }}
    >
      {initials}
    </span>
  );
}

function KickIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <line x1="17" y1="11" x2="22" y2="11" />
    </svg>
  );
}
