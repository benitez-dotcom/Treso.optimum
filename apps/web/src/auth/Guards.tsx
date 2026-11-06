import { useEffect, useState, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { Alert, Button } from 'antd';
import { ApiError } from '../api/client';
import { useSession } from '../api/session';
import { useStore } from '../store/useStore';
import { AuthLayout, FullPageSpinner } from './AuthLayout';

/** Réservé aux utilisateurs connectés ; sinon, retour à la connexion. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const status = useSession((s) => s.status);
  const location = useLocation();
  if (status === 'loading') return <FullPageSpinner />;
  if (status === 'anonymous') {
    return <Navigate to={`/connexion?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  }
  return <>{children}</>;
}

/** Charge les données de la société active ; sans société, direction l'onboarding. */
export function RequireCompany({ children }: { children: ReactNode }) {
  const me = useSession((s) => s.me);
  const load = useStore((s) => s.load);
  const loadedId = useStore((s) => (s.loaded ? s.company?.id : null));
  const [error, setError] = useState<string | null>(null);
  const companyId = me?.activeCompanyId ?? null;

  useEffect(() => {
    if (!companyId || loadedId === companyId) return;
    setError(null);
    load().catch((err) => setError(err instanceof ApiError ? err.message : 'Impossible de charger vos données.'));
  }, [companyId, loadedId, load]);

  if (!companyId) return <Navigate to="/bienvenue" replace />;
  if (error) {
    return (
      <AuthLayout>
        <Alert type="error" showIcon message={error} />
        <Button onClick={() => window.location.reload()}>Réessayer</Button>
      </AuthLayout>
    );
  }
  if (loadedId !== companyId) return <FullPageSpinner label="Chargement de votre trésorerie…" />;
  return <>{children}</>;
}

/** Les écrans d'authentification redirigent un utilisateur déjà connecté. */
export function GuestOnly({ children }: { children: ReactNode }) {
  const status = useSession((s) => s.status);
  if (status === 'loading') return <FullPageSpinner />;
  if (status === 'authenticated') return <Navigate to="/" replace />;
  return <>{children}</>;
}
