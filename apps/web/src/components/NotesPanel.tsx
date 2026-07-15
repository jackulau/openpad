import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { notesApi } from '../lib/notes';
import type { CollabClient } from '../lib/collab';
import { MarkdownView } from './MarkdownView';
import { useToasts } from '../lib/toast';
import { HttpError } from '../lib/api';

const ACCEPT = 'image/png,image/jpeg,image/gif,image/webp';

const DIFFICULTY_CHIP: Record<string, string> = {
  easy: 'chip-success',
  medium: 'chip-accent',
  hard: 'chip-danger',
};

// The pad's expandable "Notes" panel - a LeetCode-style problem description.
// Any member reads the rendered markdown + images; the owner can edit the
// description and upload images inline.
export function NotesPanel({ slug, client }: { slug: string; client?: CollabClient | null }) {
  const qc = useQueryClient();
  const push = useToasts((s) => s.push);
  const notes = useQuery({ queryKey: ['notes', slug], queryFn: () => notesApi.get(slug) });

  // Live sync: when a peer saves the problem or changes an image, the server
  // pushes a NOTES frame over the pad socket. Refetch so readers see it without
  // a manual reload. In-progress local edits live in separate state, so an
  // invalidation here never clobbers what the owner is typing.
  useEffect(() => {
    if (!client) return;
    return client.onNotes(() => {
      qc.invalidateQueries({ queryKey: ['notes', slug] });
    });
  }, [client, qc, slug]);

  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [preview, setPreview] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const question = notes.data?.question ?? null;
  const canEdit = notes.data?.canEdit ?? false;

  function startEdit() {
    setTitle(question?.title ?? '');
    setBody(question?.body ?? '');
    setPreview(false);
    setEditing(true);
  }

  const save = useMutation({
    mutationFn: () => notesApi.save(slug, { title: title.trim() || undefined, body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notes', slug] });
      setEditing(false);
      push('Notes saved', 'success');
    },
    onError: (e) => push(e instanceof HttpError ? e.error : 'Save failed', 'error'),
  });

  const upload = useMutation({
    mutationFn: (file: File) => notesApi.uploadAsset(slug, file),
    onSuccess: ({ asset }) => {
      insertAtCursor(`\n![${asset.filename}](${asset.url})\n`);
      qc.invalidateQueries({ queryKey: ['notes', slug] });
      push('Image uploaded', 'success');
    },
    onError: (e) =>
      push(
        e instanceof HttpError
          ? e.status === 413
            ? 'Image too large (max 5MB)'
            : e.status === 415
              ? 'Only PNG, JPEG, GIF or WebP images'
              : e.error
          : 'Upload failed',
        'error',
      ),
  });

  const del = useMutation({
    mutationFn: (assetId: string) => notesApi.deleteAsset(slug, assetId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notes', slug] }),
  });

  function insertAtCursor(text: string) {
    const ta = taRef.current;
    if (!ta) {
      setBody((b) => b + text);
      return;
    }
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    setBody((b) => b.slice(0, start) + text + b.slice(end));
    requestAnimationFrame(() => {
      ta.focus();
      const pos = start + text.length;
      ta.setSelectionRange(pos, pos);
    });
  }

  return (
    <div className="flex flex-col min-h-0 h-full">
      <div className="px-4 py-2 border-b border-line flex items-center gap-2">
        <h3 className="text-sm font-semibold text-primary">Notes</h3>
        {question?.difficulty && !editing && (
          <span className={DIFFICULTY_CHIP[question.difficulty] ?? 'chip'}>{question.difficulty}</span>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          {editing ? (
            <>
              <button className="btn-ghost !py-1 !px-2 text-xs" onClick={() => setEditing(false)}>
                Cancel
              </button>
              <button
                className="btn-primary !py-1 !px-2 text-xs"
                onClick={() => save.mutate()}
                disabled={save.isPending}
              >
                {save.isPending ? 'Saving…' : 'Save'}
              </button>
            </>
          ) : (
            canEdit && (
              <button className="btn-secondary !py-1 !px-2 text-xs" onClick={startEdit}>
                {question?.body ? 'Edit' : 'Add notes'}
              </button>
            )
          )}
        </div>
      </div>

      {notes.isLoading ? (
        <div className="p-4 text-sm text-subtle">loading…</div>
      ) : editing ? (
        <div className="flex flex-col min-h-0 flex-1">
          <div className="p-3 space-y-2 border-b border-line">
            <input
              className="input !py-1 !text-sm w-full"
              placeholder="Problem title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            <div className="flex items-center gap-1.5">
              <button
                className={`btn-ghost !py-1 !px-2 text-xs ${!preview ? '!bg-hover' : ''}`}
                onClick={() => setPreview(false)}
              >
                Write
              </button>
              <button
                className={`btn-ghost !py-1 !px-2 text-xs ${preview ? '!bg-hover' : ''}`}
                onClick={() => setPreview(true)}
              >
                Preview
              </button>
              <button
                className="btn-ghost !py-1 !px-2 text-xs ml-auto"
                onClick={() => fileRef.current?.click()}
                disabled={upload.isPending}
              >
                {upload.isPending ? 'Uploading…' : '＋ Image'}
              </button>
              <input
                ref={fileRef}
                type="file"
                accept={ACCEPT}
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) upload.mutate(f);
                  e.target.value = '';
                }}
              />
            </div>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto">
            {preview ? (
              <div className="p-3">
                <MarkdownView content={body} />
              </div>
            ) : (
              <textarea
                ref={taRef}
                className="input !rounded-none !border-0 w-full h-full min-h-0 resize-none font-mono !text-xs leading-relaxed"
                placeholder="Describe the problem in **markdown**. Paste examples, constraints, and use ＋ Image to attach screenshots."
                value={body}
                onChange={(e) => setBody(e.target.value)}
              />
            )}
          </div>
          {question && question.assets.length > 0 && (
            <div className="border-t border-line p-2 max-h-28 overflow-y-auto space-y-1">
              <div className="text-xs uppercase tracking-wide text-subtle px-1">Attachments</div>
              {question.assets.map((a) => (
                <div key={a.id} className="flex items-center gap-2 text-xs text-secondary px-1">
                  <span className="truncate flex-1">{a.filename}</span>
                  <button
                    className="text-xs text-accent hover:underline"
                    onClick={() => insertAtCursor(`\n![${a.filename}](${a.url})\n`)}
                  >
                    insert
                  </button>
                  <button
                    className="text-xs text-danger hover:underline"
                    onClick={() => del.mutate(a.id)}
                  >
                    delete
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto p-4">
          {question?.title && <h2 className="text-base font-semibold text-primary mb-2">{question.title}</h2>}
          {question?.body ? (
            <MarkdownView content={question.body} />
          ) : (
            <div className="text-sm text-subtle">
              <p>No problem notes yet.</p>
              {canEdit && (
                <p className="mt-1">
                  Click <strong className="text-secondary">Add notes</strong> to write a markdown
                  description and attach images.
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
