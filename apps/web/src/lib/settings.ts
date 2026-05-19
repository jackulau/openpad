import { api } from './api';
import type { PublicUser } from '@opencoder/shared';

export const settingsApi = {
  patchMe: (body: { name?: string; currentPassword?: string; newPassword?: string }) =>
    api.patch<{ user: PublicUser }>('/api/auth/me', body),
  deleteMe: (body: { confirm: 'DELETE'; password: string }) =>
    api.delete<{ ok: true }>('/api/auth/me', { body }),
};
