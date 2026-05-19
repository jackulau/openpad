import { api } from './api';

export interface InviteDTO {
  id: string;
  email: string | null;
  token: string;
  role: string;
  url: string;
  expiresAt: string | null;
  usedAt: string | null;
  createdAt: string;
}

export interface InvitePreview {
  token: string;
  role: 'collaborator' | 'viewer' | 'candidate';
  emailRestricted: boolean;
  padSlug: string;
  padTitle: string;
  expiresAt: string | null;
}

export const invitesApi = {
  list: (slug: string) => api.get<{ invites: InviteDTO[] }>(`/api/pads/${slug}/invites`),
  create: (
    slug: string,
    body: { email?: string; role?: string; expiresInHours?: number },
  ) => api.post<{ invite: InviteDTO }>(`/api/pads/${slug}/invites`, body),
  share: (slug: string, body: { role?: string; expiresInHours?: number }) =>
    api.post<{ invite: InviteDTO }>(`/api/pads/${slug}/share`, body),
  revoke: (slug: string, id: string) =>
    api.delete<{ ok: true }>(`/api/pads/${slug}/invites/${id}`),
  preview: (token: string) =>
    api.get<{ invite: InvitePreview }>(`/api/invites/${token}`),
  accept: (token: string) =>
    api.post<{ ok: true; slug: string }>(`/api/invites/${token}/accept`),
};

export const membersApi = {
  changeRole: (slug: string, memberId: string, role: 'collaborator' | 'viewer' | 'candidate') =>
    api.patch<{ ok: true; role: string }>(`/api/pads/${slug}/members/${memberId}`, { role }),
  kick: (slug: string, memberId: string) =>
    api.delete<{ ok: true }>(`/api/pads/${slug}/members/${memberId}`),
  leave: (slug: string) =>
    api.post<{ ok: true }>(`/api/pads/${slug}/members/leave`),
};
