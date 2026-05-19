import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { getToken } from '../lib/api';
import { fmtDuration, recordingsApi } from '../lib/recordings';
import { useToasts } from '../lib/toast';

interface Props {
  slug: string;
  autoRecord: boolean;
  canManage: boolean;
}

export function RecordingsPanel({ slug, autoRecord, canManage }: Props) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const push = useToasts((s) => s.push);
  const list = useQuery({
    queryKey: ['recordings', slug],
    queryFn: () => recordingsApi.list(slug),
    refetchInterval: 5000,
  });
  const toggle = useMutation({
    mutationFn: (on: boolean) => recordingsApi.setAutoRecord(slug, on),
    onSuccess: (_d, on) => {
      qc.invalidateQueries({ queryKey: ['pad', slug] });
      push(on ? 'Auto-record on. New joins will trigger a recording.' : 'Auto-record off.', 'success');
    },
  });
  const start = useMutation({
    mutationFn: () => recordingsApi.start(slug),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['recordings', slug] });
      push('Recording started', 'success');
    },
  });
  const stop = useMutation({
    mutationFn: (id: string) => recordingsApi.stop(slug, id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['recordings', slug] });
      push('Recording stopped', 'success');
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => recordingsApi.remove(slug, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['recordings', slug] }),
  });

  // Token-aware download: the export endpoint requires Authorization, so we
  // fetch the JSON ourselves and synthesize a download blob.
  async function downloadBundle(id: string) {
    const token = getToken();
    const res = await fetch(recordingsApi.exportUrl(slug, id), {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) {
      push('Download failed', 'error');
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `recording-${slug}-${id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-3 p-3 text-sm">
      <div className="flex items-center justify-between">
        <h3 className="font-medium">Recordings</h3>
        {canManage && (
          <label className="flex items-center gap-2 text-xs cursor-pointer">
            <input
              type="checkbox"
              checked={autoRecord}
              onChange={(e) => toggle.mutate(e.target.checked)}
              className="accent-accent"
            />
            Auto-record
          </label>
        )}
      </div>
      {canManage && (
        <button
          className="btn-secondary w-full !py-1.5 text-xs"
          onClick={() => start.mutate()}
          disabled={start.isPending}
        >
          {start.isPending ? 'Starting…' : 'Start recording now'}
        </button>
      )}
      {list.isLoading && <p className="text-subtle text-xs">loading…</p>}
      {list.data && list.data.recordings.length === 0 && (
        <p className="text-subtle text-xs">
          No recordings yet. Turn on auto-record to capture sessions automatically.
        </p>
      )}
      <ul className="space-y-2">
        {list.data?.recordings.map((r) => (
          <li
            key={r.id}
            className="rounded border border-line p-2 space-y-1"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-secondary">
                {new Date(r.startedAt).toLocaleString()}
              </span>
              {r.endedAt ? (
                <span className="text-[10px] text-subtle">
                  {fmtDuration(r.durationMs)}
                </span>
              ) : (
                <span className="text-[10px] text-success inline-flex items-center gap-1">
                  <span className="size-1.5 rounded-full bg-success animate-pulse" />
                  live
                </span>
              )}
            </div>
            <div className="text-[10px] text-subtle">
              {r.participants.length === 0
                ? 'no participants'
                : r.participants.map((p) => p.name).join(', ')}
              {r.autoStarted && ' · auto'}
            </div>
            <div className="flex gap-1 pt-1">
              <button
                className="text-[11px] text-accent hover:underline"
                onClick={() => navigate(`/p/${slug}/playback?recording=${r.id}`)}
              >
                Open
              </button>
              <button
                className="text-[11px] text-secondary hover:underline"
                onClick={() => downloadBundle(r.id)}
              >
                Download
              </button>
              {!r.endedAt && canManage && (
                <button
                  className="text-[11px] text-secondary hover:underline"
                  onClick={() => stop.mutate(r.id)}
                >
                  Stop
                </button>
              )}
              {canManage && (
                <button
                  className="text-[11px] text-subtle hover:text-danger ml-auto"
                  onClick={() => {
                    if (confirm('Delete this recording? Cannot be undone.')) remove.mutate(r.id);
                  }}
                >
                  Delete
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
