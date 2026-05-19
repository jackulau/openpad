import { api } from './api';

export interface SetupStatus {
  needsSetup: boolean;
  userCount: number;
}

export const setupApi = {
  status: () => api.get<SetupStatus>('/api/setup/status'),
};
