import { api } from './api';

export interface FileMeta {
  id: string;
  name: string;
  language: string;
  sortOrder: number;
  updatedAt: string;
  createdAt: string;
}

export const filesApi = {
  create: (slug: string, body: { name: string; language?: string; content?: string }) =>
    api.post<{ file: FileMeta }>(`/api/pads/${slug}/files`, body),
  rename: (slug: string, fileId: string, body: { name?: string; language?: string }) =>
    api.patch<{ file: FileMeta }>(`/api/pads/${slug}/files/${fileId}`, body),
  delete: (slug: string, fileId: string) =>
    api.delete<{ ok: true }>(`/api/pads/${slug}/files/${fileId}`),
};
