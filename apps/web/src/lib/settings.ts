import { api } from './api';
import type { PublicUser } from '@opencoder/shared';

export const settingsApi = {
  patchMe: (body: { name: string }) =>
    api.patch<{ user: PublicUser }>('/api/auth/me', body),
  deleteMe: (body: { confirm: 'DELETE' }) =>
    api.delete<{ ok: true }>('/api/auth/me', { body }),
};
