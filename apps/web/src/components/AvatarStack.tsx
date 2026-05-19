import type { PresenceUser } from '../lib/collab';

interface Props {
  me?: { id: string; name: string } | null;
  presence: Record<string, PresenceUser>;
  max?: number;
}

// Show up to `max` overlapping avatar bubbles (current user first), plus a
// "+N" overflow bubble if more are present. Hovering an avatar reveals the
// user's name; the wrapper has its own tooltip with the full roster.
export function AvatarStack({ me, presence, max = 3 }: Props) {
  const all: Array<{ id: string; name: string; color: string; you: boolean }> = [];
  if (me) {
    const own = presence[me.id];
    all.push({ id: me.id, name: me.name, color: own?.color ?? '#34d399', you: true });
  }
  for (const p of Object.values(presence)) {
    if (p.userId === me?.id) continue;
    all.push({ id: p.userId, name: p.name, color: p.color, you: false });
  }
  if (all.length === 0) return null;

  const visible = all.slice(0, max);
  const overflow = all.length - visible.length;
  const tooltip = all.map((u) => (u.you ? `${u.name} (you)` : u.name)).join('\n');

  return (
    <div
      className="flex items-center -space-x-2"
      title={tooltip}
      aria-label={`${all.length} ${all.length === 1 ? 'person' : 'people'} here`}
    >
      {visible.map((u) => (
        <span
          key={u.id}
          className="inline-flex items-center justify-center size-7 rounded-full ring-2 ring-page text-[11px] font-semibold text-white"
          style={{ backgroundColor: u.color }}
          title={u.you ? `${u.name} (you)` : u.name}
        >
          {initials(u.name)}
        </span>
      ))}
      {overflow > 0 && (
        <span className="inline-flex items-center justify-center size-7 rounded-full ring-2 ring-page text-[11px] font-semibold bg-elevated text-secondary">
          +{overflow}
        </span>
      )}
      <span className="ml-3 text-xs text-secondary hidden sm:inline">
        {all.length} {all.length === 1 ? 'person' : 'people'} here
      </span>
    </div>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  if (parts.length === 0) return '?';
  return parts.map((p) => p[0]?.toUpperCase() ?? '').join('') || '?';
}
