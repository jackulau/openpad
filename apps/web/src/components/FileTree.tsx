import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { filesApi, type FileMeta } from '../lib/files';
import { HttpError } from '../lib/api';
import type { PresenceUser } from '../lib/collab';

interface Props {
  slug: string;
  files: FileMeta[];
  activeFileId: string | null;
  onActivate: (file: FileMeta) => void;
  canEdit: boolean;
  presence?: Record<string, PresenceUser>;
  myUserId?: string | null;
}

export function FileTree({
  slug,
  files,
  activeFileId,
  onActivate,
  canEdit,
  presence,
  myUserId,
}: Props) {
  // Group remote users by the file they're currently viewing so each file row
  // can show a small stack of colored dots — same affordance as Google Docs
  // "who's on this doc" indicators, but per file.
  const viewersByFile = useMemo(() => {
    const map = new Map<string, PresenceUser[]>();
    if (!presence) return map;
    for (const p of Object.values(presence)) {
      if (!p.fileId) continue;
      if (myUserId && p.userId === myUserId) continue;
      const list = map.get(p.fileId) ?? [];
      list.push(p);
      map.set(p.fileId, list);
    }
    return map;
  }, [presence, myUserId]);
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: (name: string) => filesApi.create(slug, { name }),
    onSuccess: () => {
      setAdding(false);
      setNewName('');
      setErr(null);
      qc.invalidateQueries({ queryKey: ['pad', slug] });
    },
    onError: (e) =>
      setErr(e instanceof HttpError ? e.error : 'Failed'),
  });

  const rename = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      filesApi.rename(slug, id, { name }),
    onSuccess: () => {
      setRenamingId(null);
      setErr(null);
      qc.invalidateQueries({ queryKey: ['pad', slug] });
    },
    onError: (e) =>
      setErr(e instanceof HttpError ? e.error : 'Failed'),
  });

  const del = useMutation({
    mutationFn: (id: string) => filesApi.delete(slug, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pad', slug] }),
    onError: (e) =>
      setErr(e instanceof HttpError ? e.error : 'Failed'),
  });

  return (
    <div className="text-sm">
      <div className="flex items-center justify-between px-2 mb-1">
        <span className="text-xs uppercase tracking-wide text-subtle">Files</span>
        {canEdit && (
          <button
            className="text-secondary hover:text-primary text-base leading-none"
            onClick={() => setAdding((v) => !v)}
            title="New file"
          >
            +
          </button>
        )}
      </div>

      {adding && (
        <form
          className="px-2 mb-1"
          onSubmit={(e) => {
            e.preventDefault();
            if (newName.trim()) create.mutate(newName.trim());
          }}
        >
          <input
            autoFocus
            className="input !py-1 !text-xs"
            placeholder="filename.py"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setAdding(false);
                setNewName('');
              }
            }}
          />
        </form>
      )}

      {err && (
        <div className="px-2 text-xs text-danger mb-1">
          {err}
          <button className="ml-2 text-subtle" onClick={() => setErr(null)}>
            dismiss
          </button>
        </div>
      )}

      <ul className="space-y-0.5">
        {files.map((f) => {
          const isActive = f.id === activeFileId;
          const isRenaming = renamingId === f.id;
          return (
            <li key={f.id} className="group">
              {isRenaming ? (
                <form
                  className="px-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (renameDraft.trim() && renameDraft !== f.name) {
                      rename.mutate({ id: f.id, name: renameDraft.trim() });
                    } else {
                      setRenamingId(null);
                    }
                  }}
                >
                  <input
                    autoFocus
                    className="input !py-1 !text-xs"
                    value={renameDraft}
                    onChange={(e) => setRenameDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') setRenamingId(null);
                    }}
                    onBlur={() => setRenamingId(null)}
                  />
                </form>
              ) : (
                <div
                  className={`flex items-center justify-between px-2 py-1 rounded cursor-pointer ${
                    isActive
                      ? 'bg-elevated text-primary'
                      : 'text-secondary hover:bg-surface'
                  }`}
                  onClick={() => onActivate(f)}
                  onDoubleClick={() => {
                    if (canEdit) {
                      setRenamingId(f.id);
                      setRenameDraft(f.name);
                    }
                  }}
                >
                  <span className="truncate">{f.name}</span>
                  <FileViewers viewers={viewersByFile.get(f.id) ?? []} />
                  {canEdit && (
                    <button
                      className="opacity-0 group-hover:opacity-100 transition text-subtle hover:text-danger text-xs"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (confirm(`Delete ${f.name}?`)) del.mutate(f.id);
                      }}
                      title="Delete"
                    >
                      ✕
                    </button>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// Up to three colored dots per file row, plus +N overflow. Names go in the
// title attribute so hovering reveals the full roster.
function FileViewers({ viewers }: { viewers: PresenceUser[] }) {
  if (viewers.length === 0) return null;
  const visible = viewers.slice(0, 3);
  const overflow = viewers.length - visible.length;
  const title = viewers.map((v) => v.name).join(', ');
  return (
    <span className="flex items-center gap-0.5 ml-auto" title={title}>
      {visible.map((v) => (
        <span
          key={v.userId}
          className="size-2 rounded-full ring-1 ring-page"
          style={{ backgroundColor: v.color }}
          aria-hidden="true"
        />
      ))}
      {overflow > 0 && (
        <span className="text-[10px] text-subtle ml-0.5">+{overflow}</span>
      )}
    </span>
  );
}
