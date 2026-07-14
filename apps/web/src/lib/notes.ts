import { api, uploadFile } from './api';

export interface NoteAsset {
  id: string;
  filename: string;
  mime: string;
  size: number;
  url: string;
}

export interface NotesQuestion {
  id: string;
  title: string;
  body: string;
  language: string;
  difficulty: string;
  assets: NoteAsset[];
}

export interface NotesView {
  canEdit: boolean;
  kind: string;
  question: NotesQuestion | null;
}

export const notesApi = {
  get: (slug: string) => api.get<NotesView>(`/api/pads/${slug}/notes`),
  save: (slug: string, body: { title?: string; body: string }) =>
    api.put<{ question: NotesQuestion }>(`/api/pads/${slug}/notes`, body),
  uploadAsset: (slug: string, file: File) =>
    uploadFile<{ asset: NoteAsset }>(`/api/pads/${slug}/notes/assets`, file),
  deleteAsset: (slug: string, assetId: string) =>
    api.delete<{ ok: true }>(`/api/pads/${slug}/notes/assets/${assetId}`),
};
