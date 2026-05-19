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
  // Server atomically renames the file to the new language's default filename
  // AND replaces template content (when pristine). Drops yjsState so editor
  // re-seeds from `content`.
  relanguage: (slug: string, fileId: string, language: string) =>
    api.patch<{ file: FileMeta; contentReplaced: boolean }>(
      `/api/pads/${slug}/files/${fileId}/relanguage`,
      { language },
    ),
  delete: (slug: string, fileId: string) =>
    api.delete<{ ok: true }>(`/api/pads/${slug}/files/${fileId}`),
};
