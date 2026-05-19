import type { RunResult } from '@opencoder/shared';
import { api } from './api';

export const execApi = {
  run: (slug: string, body: { source: string; language?: string; filename?: string; stdin?: string; timeoutMs?: number }) =>
    api.post<RunResult>(`/api/pads/${slug}/run`, body),
};
