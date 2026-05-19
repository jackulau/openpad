import type { PadSummary } from '@opencoder/shared';
import { api } from './api';

export interface PadDetail {
  pad: PadSummary;
  files: Array<{
    id: string;
    name: string;
    language: string;
    sortOrder: number;
    updatedAt: string;
    createdAt: string;
  }>;
  members: Array<{ id: string; userId: string; role: string; name: string; email: string }>;
}

export const padsApi = {
  list: () => api.get<{ pads: PadSummary[] }>('/api/pads'),
  create: (body: {
    title?: string;
    language?: string;
    kind?: 'sandbox' | 'interview';
    template?: 'hello' | 'leetcode';
  }) => api.post<{ pad: PadSummary }>('/api/pads', body),
  get: (slug: string) => api.get<PadDetail>(`/api/pads/${slug}`),
  patch: (slug: string, body: { title?: string; language?: string; kind?: string }) =>
    api.patch<{ pad: PadSummary }>(`/api/pads/${slug}`, body),
  delete: (slug: string) => api.delete<{ ok: true }>(`/api/pads/${slug}`),
  fork: (slug: string) => api.post<{ pad: PadSummary }>(`/api/pads/${slug}/fork`),
  patchPackages: (slug: string, body: Record<string, string[]>) =>
    api.patch<{ ok: true }>(`/api/pads/${slug}/packages`, body),
};
