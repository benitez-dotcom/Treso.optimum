import { useNavigate } from 'react-router-dom';
import { App, Button } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { useSession } from '../api/session';
import { useStore } from '../store/useStore';

const planLabels: Record<string, string> = {
  DISCOVERY: 'Découverte',
  ESSENTIAL: 'Essentiel',
  PERFORMANCE: 'Performance',
  GROUP: 'Groupe',
  FIRM: 'Cabinet',
  DEMO: 'Démonstration',
};

export function CompaniesPage() {
  const { message } = App.useApp();
  const me = useSession((s) => s.me);
  const switchCompany = useSession((s) => s.switchCompany);
  const clear = useStore((s) => s.clear);
  const navigate = useNavigate();
  if (!me) return null;

  return (
    <section className="stack" style={{ maxWidth: 880 }}>
      <div className="companies-grid">
        {me.companies.map((c) => {
          const active = c.id === me.activeCompanyId;
          return (
            <button
              key={c.id}
              type="button"
              className={`card company-card${active ? ' active' : ''}`}
              aria-current={active ? 'true' : undefined}
              onClick={async () => {
                if (active) return navigate('/');
                clear();
                await switchCompany(c.id);
                message.success(`Vous travaillez maintenant sur ${c.name}.`);
                navigate('/');
              }}
            >
              <strong>{c.name}</strong>
              <span className="muted">Offre {planLabels[c.plan] ?? c.plan} · {c.roleLabel}</span>
              {active && <span className="badge ok">Société active</span>}
            </button>
          );
        })}
      </div>
      <div>
        <Button icon={<PlusOutlined />} onClick={() => navigate('/bienvenue')}>
          Ajouter une société
        </Button>
      </div>
    </section>
  );
}
