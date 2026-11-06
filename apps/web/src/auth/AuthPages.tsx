import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Alert, Button, Checkbox, Form, Input } from 'antd';
import { api, ApiError, fieldErrors } from '../api/client';
import { useSession } from '../api/session';
import type { Session } from '../api/types';
import { AuthLayout, FullPageSpinner } from './AuthLayout';

interface DevLinkResponse {
  message: string;
  devLink?: string;
}

/** En développement, l'API renvoie le lien de l'email pour pouvoir tester sans boîte mail. */
function DevLink({ link }: { link?: string }) {
  if (!link) return null;
  const path = link.replace(/^https?:\/\/[^/]+/, '');
  return (
    <p className="dev-link">
      Mode développement — lien de l'email : <Link to={path}>{path}</Link>
    </p>
  );
}

function errorMessage(err: unknown): string {
  return err instanceof ApiError ? err.message : 'Un incident est survenu. Réessayez dans un instant.';
}

function useAfterLogin() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const start = useSession((s) => s.start);
  return async (session: Session) => {
    await start(session);
    const next = params.get('next');
    navigate(next && next.startsWith('/') ? next : '/', { replace: true });
  };
}

/** Jauge de robustesse indicative (longueur et variété), sans règle bloquante. */
function strength(pw: string): number {
  let score = 0;
  if (pw.length >= 10) score++;
  if (pw.length >= 14) score++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
  if (/[0-9]/.test(pw) || /[^A-Za-z0-9]/.test(pw) || pw.includes(' ')) score++;
  return score;
}

function PasswordField({ name = 'password', label = 'Mot de passe', autoComplete = 'new-password' }: { name?: string; label?: string; autoComplete?: string }) {
  const value = Form.useWatch(name) as string | undefined;
  const s = strength(value ?? '');
  const labels = ['Trop court', 'Correct', 'Bon', 'Solide', 'Excellent'];
  return (
    <Form.Item
      name={name}
      label={label}
      rules={[{ required: true, message: 'Choisissez un mot de passe.' }, { min: 10, message: 'Au moins 10 caractères. Une courte phrase fonctionne très bien.' }]}
      extra={
        <>
          <div className="strength" aria-hidden="true">
            {[0, 1, 2, 3].map((i) => (
              <span key={i} className={i < s ? 'on' : ''} />
            ))}
          </div>
          <span className="strength-label">{value ? labels[s] : 'Au moins 10 caractères. Une courte phrase fonctionne très bien.'}</span>
        </>
      }
    >
      <Input.Password autoComplete={autoComplete} size="large" />
    </Form.Item>
  );
}

export function LoginPage() {
  const [form] = Form.useForm();
  const [error, setError] = useState<{ message: string; code: string } | null>(null);
  const [info, setInfo] = useState<DevLinkResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const afterLogin = useAfterLogin();

  const submit = async (v: { email: string; password: string; remember: boolean }) => {
    setBusy(true);
    setError(null);
    try {
      await afterLogin(await api<Session>('POST', '/auth/login', v));
    } catch (err) {
      setError({ message: errorMessage(err), code: err instanceof ApiError ? err.code : '' });
    } finally {
      setBusy(false);
    }
  };

  const magic = async () => {
    const email = form.getFieldValue('email') as string | undefined;
    if (!email) {
      form.validateFields(['email']);
      return;
    }
    setInfo(await api<DevLinkResponse>('POST', '/auth/magic-link', { email }).catch((e) => ({ message: errorMessage(e) })));
  };

  const resend = async () => {
    setInfo(await api<DevLinkResponse>('POST', '/auth/email/resend', { email: form.getFieldValue('email') }).catch((e) => ({ message: errorMessage(e) })));
  };

  return (
    <AuthLayout>
      <h1>Bienvenue</h1>
      <p className="lead">Connectez-vous pour retrouver votre trésorerie.</p>
      {error && (
        <Alert
          type="error"
          showIcon
          message={error.message}
          action={error.code === 'auth.email_not_verified' ? <Button size="small" onClick={resend}>Renvoyer l'email</Button> : undefined}
        />
      )}
      {info && (
        <Alert type="info" showIcon message={info.message} description={<DevLink link={info.devLink} />} />
      )}
      <Form form={form} layout="vertical" onFinish={submit} initialValues={{ remember: true }} requiredMark={false}>
        <Form.Item name="email" label="Adresse email" rules={[{ required: true, type: 'email', message: 'Indiquez une adresse email valide.' }]}>
          <Input autoComplete="email" size="large" placeholder="nom@entreprise.fr" />
        </Form.Item>
        <Form.Item name="password" label="Mot de passe" rules={[{ required: true, message: 'Indiquez votre mot de passe.' }]}>
          <Input.Password autoComplete="current-password" size="large" />
        </Form.Item>
        <div className="auth-links">
          <Form.Item name="remember" valuePropName="checked" noStyle>
            <Checkbox>Rester connecté 30 jours</Checkbox>
          </Form.Item>
          <Link to="/mot-de-passe-oublie">Mot de passe oublié ?</Link>
        </div>
        <Button type="primary" htmlType="submit" size="large" block loading={busy} style={{ marginTop: 20 }}>
          Me connecter
        </Button>
      </Form>
      <Button block onClick={magic}>Recevoir un lien de connexion par email</Button>
      <p className="lead">
        Pas encore de compte ? <Link to="/inscription">Créer mon compte</Link>
      </p>
    </AuthLayout>
  );
}

export function SignupPage() {
  const [form] = Form.useForm();
  const [sent, setSent] = useState<(DevLinkResponse & { email: string }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (v: { firstName: string; email: string; password: string; acceptTerms: boolean }) => {
    setBusy(true);
    setError(null);
    try {
      const res = await api<DevLinkResponse>('POST', '/auth/signup', v);
      setSent({ ...res, email: v.email });
    } catch (err) {
      const fields = fieldErrors(err);
      if (Object.keys(fields).length) form.setFields(Object.entries(fields).map(([name, msg]) => ({ name, errors: [msg] })));
      else setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <AuthLayout>
        <h1>Vérifiez votre boîte mail</h1>
        <p className="lead">
          Nous avons envoyé un lien de confirmation à <strong>{sent.email}</strong>. Il est valable 24 heures.
        </p>
        <p className="lead">Pas d'email ? Vérifiez vos courriers indésirables, ou renvoyez-le.</p>
        <DevLink link={sent.devLink} />
        <Button onClick={() => api<DevLinkResponse>('POST', '/auth/email/resend', { email: sent.email }).then((r) => setSent({ ...sent, ...r }))}>
          Renvoyer l'email
        </Button>
        <Button type="link" onClick={() => setSent(null)}>Modifier l'adresse</Button>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <h1>Créer mon compte</h1>
      <p className="lead">14 jours d'essai de l'offre Performance, sans carte bancaire.</p>
      {error && <Alert type="error" showIcon message={error} />}
      <Form form={form} layout="vertical" onFinish={submit} requiredMark={false}>
        <Form.Item name="firstName" label="Prénom" rules={[{ required: true, message: 'Indiquez votre prénom.' }]}>
          <Input autoComplete="given-name" size="large" />
        </Form.Item>
        <Form.Item name="email" label="Adresse email professionnelle" rules={[{ required: true, type: 'email', message: 'Indiquez une adresse email valide.' }]}>
          <Input autoComplete="email" size="large" placeholder="nom@entreprise.fr" />
        </Form.Item>
        <PasswordField />
        <Form.Item
          name="acceptTerms"
          valuePropName="checked"
          rules={[{ validator: (_, v) => (v ? Promise.resolve() : Promise.reject(new Error("Acceptez les conditions d'utilisation pour continuer."))) }]}
        >
          <Checkbox>J'accepte les conditions d'utilisation et la politique de confidentialité</Checkbox>
        </Form.Item>
        <Button type="primary" htmlType="submit" size="large" block loading={busy}>
          Créer mon compte
        </Button>
      </Form>
      <p className="lead">
        Déjà un compte ? <Link to="/connexion">Me connecter</Link>
      </p>
    </AuthLayout>
  );
}

/** Consomme un jeton reçu par email (vérification ou lien magique) puis ouvre la session. */
function TokenLanding({ endpoint, title }: { endpoint: string; title: string }) {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const afterLogin = useAfterLogin();
  const [error, setError] = useState<string | null>(null);
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    api<Session>('POST', endpoint, { token })
      .then(afterLogin)
      .catch((err) => setError(errorMessage(err)));
  }, [endpoint, token, afterLogin]);
  if (!error) return <FullPageSpinner label={title} />;
  return (
    <AuthLayout>
      <h1>Lien expiré</h1>
      <Alert type="error" showIcon message={error} />
      <Link to="/connexion">Retour à la connexion</Link>
    </AuthLayout>
  );
}

export const VerifyEmailPage = () => <TokenLanding endpoint="/auth/email/verify" title="Confirmation de votre adresse…" />;
export const MagicLinkPage = () => <TokenLanding endpoint="/auth/magic-link/verify" title="Connexion en cours…" />;

export function ForgotPasswordPage() {
  const [res, setRes] = useState<DevLinkResponse | null>(null);
  return (
    <AuthLayout>
      <h1>Mot de passe oublié</h1>
      <p className="lead">Indiquez votre adresse : nous vous envoyons un lien pour en choisir un nouveau.</p>
      {res ? (
        <Alert type="success" showIcon message={res.message} description={<DevLink link={res.devLink} />} />
      ) : (
        <Form layout="vertical" requiredMark={false} onFinish={(v: { email: string }) => api<DevLinkResponse>('POST', '/auth/password/forgot', v).then(setRes)}>
          <Form.Item name="email" label="Adresse email" rules={[{ required: true, type: 'email', message: 'Indiquez une adresse email valide.' }]}>
            <Input autoComplete="email" size="large" />
          </Form.Item>
          <Button type="primary" htmlType="submit" size="large" block>
            Recevoir le lien
          </Button>
        </Form>
      )}
      <Link to="/connexion">Retour à la connexion</Link>
    </AuthLayout>
  );
}

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const afterLogin = useAfterLogin();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <AuthLayout>
      <h1>Nouveau mot de passe</h1>
      <p className="lead">Toutes vos autres sessions seront fermées.</p>
      {error && <Alert type="error" showIcon message={error} />}
      <Form
        layout="vertical"
        requiredMark={false}
        onFinish={async (v: { password: string }) => {
          setBusy(true);
          try {
            await afterLogin(await api<Session>('POST', '/auth/password/reset', { token: params.get('token'), password: v.password }));
          } catch (err) {
            setError(errorMessage(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <PasswordField label="Nouveau mot de passe" />
        <Button type="primary" htmlType="submit" size="large" block loading={busy}>
          Enregistrer et me connecter
        </Button>
      </Form>
    </AuthLayout>
  );
}

interface InvitationInfo {
  companyName: string;
  email: string;
  roleLabel: string;
  inviter: string | null;
  hasAccount: boolean;
}

export function InvitationPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const navigate = useNavigate();
  const { status, me, reloadMe, start } = useSession();
  const [info, setInfo] = useState<InvitationInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<InvitationInfo>('GET', `/invitations/${encodeURIComponent(token)}`)
      .then(setInfo)
      .catch((err) => setError(errorMessage(err)));
  }, [token]);

  const accept = async (body?: { firstName: string; password: string }) => {
    setBusy(true);
    setError(null);
    try {
      await api('POST', `/invitations/${encodeURIComponent(token)}/accept`, body ?? {});
      if (body && info) await start(await api<Session>('POST', '/auth/login', { email: info.email, password: body.password }));
      else await reloadMe();
      navigate('/', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const loggedAsInvitee = useMemo(() => status === 'authenticated' && me?.email.toLowerCase() === info?.email.toLowerCase(), [status, me, info]);

  return (
    <AuthLayout>
      <h1>Invitation</h1>
      {error && <Alert type="error" showIcon message={error} />}
      {!info && !error && <p className="lead">Chargement de l'invitation…</p>}
      {info && (
        <>
          <p className="lead">
            {info.inviter ?? 'Un administrateur'} vous invite à rejoindre <strong>{info.companyName}</strong> sur Tréso Optimum en tant que{' '}
            <strong>{info.roleLabel}</strong>.
          </p>
          {loggedAsInvitee ? (
            <Button type="primary" size="large" loading={busy} onClick={() => accept()}>
              Rejoindre {info.companyName}
            </Button>
          ) : info.hasAccount ? (
            <>
              <p className="lead">Un compte existe déjà pour {info.email}. Connectez-vous pour accepter.</p>
              <Link to={`/connexion?next=${encodeURIComponent(`/invitation?token=${token}`)}`}>
                <Button type="primary" size="large" block>Me connecter</Button>
              </Link>
            </>
          ) : (
            <Form layout="vertical" requiredMark={false} onFinish={(v: { firstName: string; password: string }) => accept(v)}>
              <Form.Item label="Adresse email">
                <Input value={info.email} disabled size="large" />
              </Form.Item>
              <Form.Item name="firstName" label="Prénom" rules={[{ required: true, message: 'Indiquez votre prénom.' }]}>
                <Input autoComplete="given-name" size="large" />
              </Form.Item>
              <PasswordField />
              <Button type="primary" htmlType="submit" size="large" block loading={busy}>
                Créer mon compte et rejoindre
              </Button>
            </Form>
          )}
        </>
      )}
    </AuthLayout>
  );
}
