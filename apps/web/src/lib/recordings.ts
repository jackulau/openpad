import { api } from './api';

export interface RecordingSummary {
  id: string;
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
  autoStarted: boolean;
  participants: Array<{ userId: string; name: string }>;
}

export const recordingsApi = {
  list: (slug: string) =>
    api.get<{ recordings: RecordingSummary[] }>(`/api/pads/${slug}/recordings`),
  setAutoRecord: (slug: string, on: boolean) =>
    api.patch<{ ok: true; autoRecord: boolean }>(
      `/api/pads/${slug}/auto-record`,
      { autoRecord: on },
    ),
  start: (slug: string) =>
    api.post<{ recordingId: string; startedAt: string }>(`/api/pads/${slug}/recordings`),
  stop: (slug: string, id: string) =>
    api.post<{ ok: boolean }>(`/api/pads/${slug}/recordings/${id}/stop`),
  remove: (slug: string, id: string) =>
    api.delete<{ ok: boolean }>(`/api/pads/${slug}/recordings/${id}`),
  exportUrl: (slug: string, id: string) => `/api/pads/${slug}/recordings/${id}/export`,
};

export function fmtDuration(ms: number | null | undefined): string {
  if (!ms || ms < 0) return '-';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const sec = s % 60;
  if (m < 60) return `${m}m ${sec}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}
