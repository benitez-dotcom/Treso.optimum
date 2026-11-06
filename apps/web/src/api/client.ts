/**
 * Client de l'API Tréso Optimum. Le jeton d'accès reste en mémoire ; la session
 * longue est portée par un cookie httpOnly que seul `/auth/refresh` lit.
 */
const BASE = import.meta.env.VITE_API_URL ?? '/api/v1';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: { path: string; message: string }[],
  ) {
    super(message);
  }
}

let accessToken: string | null = null;
let refreshing: Promise<boolean> | null = null;
let onSessionLost: () => void = () => undefined;

export const setAccessToken = (t: string | null) => {
  accessToken = t;
};
export const hasAccessToken = () => accessToken !== null;
export const onSessionExpired = (fn: () => void) => {
  onSessionLost = fn;
};

async function parse(res: Response): Promise<unknown> {
  if (res.status === 204) return null;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function toError(res: Response): Promise<ApiError> {
  const body = (await parse(res).catch(() => null)) as { code?: string; title?: string; details?: { path: string; message: string }[] } | null;
  return new ApiError(res.status, body?.code ?? 'server.error', body?.title ?? 'Un incident est survenu. Réessayez dans un instant.', body?.details);
}

/** Échange le cookie de session contre un nouveau jeton d'accès (une seule requête à la fois). */
export function refreshSession(): Promise<boolean> {
  refreshing ??= fetch(`${BASE}/auth/refresh`, { method: 'POST', credentials: 'include' })
    .then(async (res) => {
      if (!res.ok) {
        accessToken = null;
        return false;
      }
      const body = (await res.json()) as { accessToken: string };
      accessToken = body.accessToken;
      return true;
    })
    .catch(() => false)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

export async function api<T>(method: string, path: string, body?: unknown, retry = true): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      credentials: 'include',
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'network', 'Connexion perdue. Vérifiez votre accès à internet puis réessayez.');
  }
  if (res.status === 401 && retry && !path.startsWith('/auth/')) {
    if (await refreshSession()) return api<T>(method, path, body, false);
    onSessionLost();
  }
  if (!res.ok) throw await toError(res);
  return (await parse(res)) as T;
}

/** Messages d'erreur d'un formulaire, par champ (erreurs de validation 422). */
export function fieldErrors(err: unknown): Record<string, string> {
  if (!(err instanceof ApiError) || !err.details) return {};
  return Object.fromEntries(err.details.map((d) => [d.path, d.message]));
}
