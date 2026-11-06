import { Link, useLocation } from 'react-router-dom';
import { Button } from 'antd';
import { MotifStrip } from '../layout/Brand';

const names: Record<string, string> = {
  '/journalier': 'Au jour le jour',
  '/operations': 'Opérations bancaires',
  '/factures/clients': 'Factures clients',
  '/factures/fournisseurs': 'Factures fournisseurs',
  '/analyses': 'Analyses',
  '/indicateurs': 'Indicateurs',
  '/conseiller': 'Mon conseiller Optimum',
  '/parametres': 'Paramètres',
};

/** État vide des écrans prévus dans les prochains lots. */
export function ComingSoon() {
  const { pathname } = useLocation();
  return (
    <section className="card" style={{ padding: 0, overflow: 'hidden', maxWidth: 640 }}>
      <MotifStrip height={64} />
      <div style={{ padding: '24px 28px 28px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h2 style={{ fontSize: 22 }}>{names[pathname] ?? 'Écran à venir'}</h2>
        <p style={{ margin: 0, color: 'var(--opt-text-muted)' }}>
          Cet écran arrive dans un prochain lot. Il est décrit en détail dans le cahier des charges.
        </p>
        <Link to="/plan">
          <Button type="primary">Ouvrir le plan de trésorerie</Button>
        </Link>
      </div>
    </section>
  );
}
