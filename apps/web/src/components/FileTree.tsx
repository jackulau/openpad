import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { filesApi, type FileMeta } from '../lib/files';
import { HttpError } from '../lib/api';

interface Props {
  slug: string;
  files: FileMeta[];
  activeFileId: string | null;
  onActivate: (file: FileMeta) => void;
  canEdit: boolean;
}

export function FileTree({ slug, files, activeFileId, onActivate, canEdit }: Props) {
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
        <span className="text-xs uppercase tracking-wide text-zinc-500">Files</span>
        {canEdit && (
          <button
            className="text-zinc-400 hover:text-zinc-100 text-base leading-none"
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
        <div className="px-2 text-xs text-red-400 mb-1">
          {err}
          <button className="ml-2 text-zinc-500" onClick={() => setErr(null)}>
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
                      ? 'bg-zinc-800 text-zinc-100'
                      : 'text-zinc-400 hover:bg-zinc-900'
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
                  {canEdit && (
                    <button
                      className="opacity-0 group-hover:opacity-100 transition text-zinc-500 hover:text-red-400 text-xs"
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
