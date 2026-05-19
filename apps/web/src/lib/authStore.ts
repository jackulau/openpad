import { create } from 'zustand';
import type { PublicUser } from '@opencoder/shared';
import { api, getToken, setToken } from './api';

interface AuthState {
  user: PublicUser | null;
  loading: boolean;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  guest: (name: string) => Promise<void>;
  logout: () => Promise<void>;
}

export const useAuth = create<AuthState>((set, get) => ({
  user: null,
  loading: false,
  hydrated: false,
  hydrate: async () => {
    if (get().hydrated) return;
    const token = getToken();
    if (!token) {
      set({ hydrated: true });
      return;
    }
    try {
      const res = await api.get<{ user: PublicUser }>('/api/auth/me');
      set({ user: res.user, hydrated: true });
    } catch {
      setToken(null);
      set({ user: null, hydrated: true });
    }
  },
  guest: async (name) => {
    set({ loading: true });
    try {
      const res = await api.post<{ token: string; user: PublicUser }>('/api/auth/guest', {
        name,
      });
      setToken(res.token);
      set({ user: res.user, hydrated: true });
    } finally {
      set({ loading: false });
    }
  },
  logout: async () => {
    try {
      await api.post('/api/auth/logout');
    } catch {
      // ignore
    }
    setToken(null);
    set({ user: null });
  },
}));
