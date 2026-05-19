import { api } from './api';

export interface PadPreview {
  slug: string;
  title: string;
  kind: 'sandbox' | 'interview';
  hasPassword: boolean;
}

export const passwordApi = {
  preview: (slug: string) => api.get<PadPreview>(`/api/pads/${slug}/preview`),
  set: (slug: string, password: string | null, role?: 'collaborator' | 'viewer' | 'candidate') =>
    api.patch<{ ok: true; hasPassword: boolean }>(`/api/pads/${slug}/password`, {
      password,
      role,
    }),
  unlock: (slug: string, password: string) =>
    api.post<{ ok: true; slug: string; role: string }>(`/api/pads/${slug}/unlock`, {
      password,
    }),
};
