import { create } from 'zustand';
import { api, onSessionExpired, refreshSession, setAccessToken } from './client';
import type { Me, Session } from './types';

type Status = 'loading' | 'anonymous' | 'authenticated';

interface SessionState {
  status: Status;
  me: Me | null;
  /** Restaure la session au chargement (cookie de rafraîchissement). */
  init: () => Promise<void>;
  /** Ouvre une session à partir d'une réponse d'authentification. */
  start: (session: Session) => Promise<void>;
  reloadMe: () => Promise<Me | null>;
  switchCompany: (companyId: string) => Promise<void>;
  logout: () => Promise<void>;
}

export const useSession = create<SessionState>()((set, get) => ({
  status: 'loading',
  me: null,

  init: async () => {
    if (await refreshSession()) {
      await get().reloadMe();
    } else {
      set({ status: 'anonymous', me: null });
    }
  },

  start: async (session) => {
    setAccessToken(session.accessToken);
    await get().reloadMe();
  },

  reloadMe: async () => {
    try {
      const me = await api<Me>('GET', '/me');
      set({ status: 'authenticated', me });
      return me;
    } catch {
      setAccessToken(null);
      set({ status: 'anonymous', me: null });
      return null;
    }
  },

  switchCompany: async (companyId) => {
    await api('PUT', '/me/active-company', { companyId });
    await get().reloadMe();
  },

  logout: async () => {
    await api('POST', '/auth/logout').catch(() => undefined);
    setAccessToken(null);
    set({ status: 'anonymous', me: null });
  },
}));

onSessionExpired(() => {
  setAccessToken(null);
  useSession.setState({ status: 'anonymous', me: null });
});
