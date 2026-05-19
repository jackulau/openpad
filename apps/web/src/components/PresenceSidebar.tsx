import type { PresenceUser } from '../lib/collab';

interface Props {
  me?: { id: string; name: string } | null;
  presence: Record<string, PresenceUser>;
  files: Array<{ id: string; name: string }>;
}

export function PresenceSidebar({ me, presence, files }: Props) {
  const fileById = new Map(files.map((f) => [f.id, f.name]));
  const others = Object.values(presence).filter((p) => p.userId !== me?.id);
  return (
    <section className="space-y-1">
      <div className="text-xs uppercase tracking-wide text-subtle px-2 mt-4 mb-1">
        Live ({others.length + (me ? 1 : 0)})
      </div>
      {me && (
        <div className="px-2 py-1 text-xs text-secondary flex items-center gap-2">
          <span className="size-2 rounded-full bg-accent" />
          <span className="truncate">{me.name}</span>
          <span className="text-subtle ml-auto">you</span>
        </div>
      )}
      {others.length === 0 && (
        <div className="px-2 py-1 text-xs text-subtle">No friends here yet.</div>
      )}
      {others.map((p) => (
        <div key={p.userId} className="px-2 py-1 text-xs text-secondary flex items-center gap-2">
          <span
            className="size-2 rounded-full"
            style={{ backgroundColor: p.color }}
            aria-hidden="true"
          />
          <span className="truncate">{p.name}</span>
          {p.fileId && fileById.has(p.fileId) && (
            <span className="text-subtle ml-auto truncate">{fileById.get(p.fileId)}</span>
          )}
        </div>
      ))}
    </section>
  );
}
