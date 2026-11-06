import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Button, Form, Input, Select } from 'antd';
import { api, ApiError } from '../api/client';
import { useSession } from '../api/session';
import { useStore } from '../store/useStore';
import { AuthLayout } from './AuthLayout';

const sectors = ['Artisanat et BTP', 'Commerce', 'Services aux entreprises', 'Restauration et hôtellerie', 'Profession libérale', 'Industrie', 'Autre'];

/** Création de la première société (ou d'une société supplémentaire). */
export function OnboardingPage() {
  const me = useSession((s) => s.me);
  const reloadMe = useSession((s) => s.reloadMe);
  const logout = useSession((s) => s.logout);
  const clear = useStore((s) => s.clear);
  const navigate = useNavigate();
  const [mode, setMode] = useState<'real' | 'demo'>('real');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const create = async (v: { name?: string; siren?: string; sector?: string }) => {
    setBusy(true);
    setError(null);
    try {
      await api('POST', '/companies', mode === 'demo' ? { name: 'Atelier Démo', demo: true } : { ...v, demo: false });
      clear();
      await reloadMe();
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'La société n\'a pas pu être créée.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout>
      <h1>{me?.companies.length ? 'Ajouter une société' : `Bienvenue ${me?.firstName ?? ''}`}</h1>
      <p className="lead">Commençons par votre entreprise. Vous pourrez connecter vos banques juste après.</p>
      <div className="choice-cards" role="radiogroup" aria-label="Type de société">
        <button type="button" role="radio" aria-checked={mode === 'real'} className={`choice-card${mode === 'real' ? ' selected' : ''}`} onClick={() => setMode('real')}>
          <strong>Mon entreprise</strong>
          <span>Je pilote ma vraie trésorerie.</span>
        </button>
        <button type="button" role="radio" aria-checked={mode === 'demo'} className={`choice-card${mode === 'demo' ? ' selected' : ''}`} onClick={() => setMode('demo')}>
          <strong>Données de démonstration</strong>
          <span>J'explore avec « Atelier Démo ».</span>
        </button>
      </div>
      {error && <Alert type="error" showIcon message={error} />}
      <Form layout="vertical" requiredMark={false} onFinish={create}>
        {mode === 'real' && (
          <>
            <Form.Item name="name" label="Nom de l'entreprise" rules={[{ required: true, message: "Indiquez le nom de l'entreprise." }]}>
              <Input size="large" autoComplete="organization" />
            </Form.Item>
            <Form.Item name="siren" label="SIREN (facultatif)" rules={[{ pattern: /^\d{9}$/, message: 'Le SIREN compte 9 chiffres.' }]}>
              <Input size="large" inputMode="numeric" maxLength={9} />
            </Form.Item>
            <Form.Item name="sector" label="Secteur d'activité">
              <Select size="large" allowClear options={sectors.map((s) => ({ value: s, label: s }))} placeholder="Choisir" />
            </Form.Item>
          </>
        )}
        <Button type="primary" htmlType="submit" size="large" block loading={busy}>
          {mode === 'demo' ? 'Explorer la démonstration' : 'Créer ma société'}
        </Button>
      </Form>
      {me?.companies.length ? (
        <Button type="link" onClick={() => navigate(-1)}>Annuler</Button>
      ) : (
        <Button type="link" onClick={() => logout()}>Se déconnecter</Button>
      )}
    </AuthLayout>
  );
}
