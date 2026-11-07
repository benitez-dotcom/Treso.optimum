import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Alert, App, Button, Checkbox, DatePicker, Drawer, Dropdown, Form, Input, InputNumber, Modal, Radio, Spin, Switch, Tag, Tooltip } from 'antd';
import { BankOutlined, EditOutlined, MoreOutlined, PlusOutlined, SyncOutlined, WalletOutlined } from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import { formatEuro, type BankAccount, type BankConnection } from '@optimum/treso-engine';
import { api, ApiError } from '../../api/client';
import { accountLabel, canAdmin } from '../../api/types';
import { useStore } from '../../store/useStore';

const errMsg = (e: unknown, f: string) => (e instanceof ApiError ? e.message : f);

const typeLabels: Record<string, string> = { checking: 'Compte courant', savings: 'Épargne', card: 'Carte', loan: 'Crédit', cash: 'Caisse', other: 'Autre' };

function since(iso: string | null | undefined): string {
  if (!iso) return 'jamais synchronisée';
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "à l'instant";
  if (mins < 60) return `il y a ${mins} min`;
  const h = Math.round(mins / 60);
  if (h < 24) return `il y a ${h} h`;
  return `le ${new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}`;
}

function StatusTag({ c, onRepair, onRetry }: { c: BankConnection; onRepair: () => void; onRetry: () => void }) {
  if (c.status === 'ok') return <Tag color="green">À jour · {since(c.lastSyncAt)}</Tag>;
  if (c.status === 'action_required')
    return (
      <span className="bank-status">
        <Tag color="orange">Action requise</Tag>
        <Button size="small" onClick={onRepair}>{c.statusDetail?.toLowerCase().includes('code') ? 'Saisir le code reçu' : "Renouveler l'accès"}</Button>
      </span>
    );
  return (
    <span className="bank-status">
      <Tag color="red">Erreur</Tag>
      <Button size="small" onClick={onRetry}>Réessayer</Button>
    </span>
  );
}

/** Réglages d'un compte (drawer). */
function AccountDrawer({ account, onClose }: { account: BankAccount | null; onClose: () => void }) {
  const { message } = App.useApp();
  const load = useStore((s) => s.load);
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (account)
      form.setFieldsValue({
        displayName: account.displayName ?? '',
        balanceSource: account.balanceSource ?? 'balance',
        ignoreDeferredCard: account.ignoreDeferredCard ?? false,
        isDefaultForCommitments: account.isDefaultForCommitments ?? false,
        openingBalance: account.openingBalance,
        openingDate: account.openingDate ? dayjs(account.openingDate) : null,
      });
  }, [account, form]);
  if (!account) return null;
  const b = account.balances;
  const fmt = (n: number | null | undefined) => (n === null || n === undefined ? 'Non fourni par la banque' : formatEuro(n));

  return (
    <Drawer open onClose={onClose} width={440} title={accountLabel(account)} destroyOnHidden
      extra={<Button type="primary" loading={saving} onClick={() => form.submit()}>Enregistrer</Button>}>
      <Form
        form={form}
        layout="vertical"
        requiredMark={false}
        onFinish={async (v) => {
          setSaving(true);
          try {
            await api('PATCH', `/bank-accounts/${encodeURIComponent(account.id)}`, {
              displayName: v.displayName?.trim() || null,
              ignoreDeferredCard: v.ignoreDeferredCard,
              isDefaultForCommitments: v.isDefaultForCommitments,
              ...(account.isManual
                ? { openingBalance: v.openingBalance, openingDate: (v.openingDate as Dayjs).format('YYYY-MM-DD') }
                : { balanceSource: v.balanceSource }),
            });
            await load();
            message.success('Compte enregistré');
            onClose();
          } catch (e) {
            message.error(errMsg(e, "Le compte n'a pas pu être enregistré."));
          } finally {
            setSaving(false);
          }
        }}
      >
        <Form.Item name="displayName" label="Nom d'affichage" extra={`Nom fourni par la banque : ${account.name}`}>
          <Input maxLength={80} placeholder={account.name} />
        </Form.Item>
        {account.isManual ? (
          <div className="inline-row">
            <Form.Item name="openingBalance" label="Solde d'ouverture" rules={[{ required: true }]}>
              <InputNumber<number> precision={2} decimalSeparator="," addonAfter="€" style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="openingDate" label="Au" rules={[{ required: true }]}>
              <DatePicker format="DD/MM/YYYY" style={{ width: '100%' }} />
            </Form.Item>
          </div>
        ) : (
          <Form.Item name="balanceSource" label="Solde retenu pour la trésorerie">
            <Radio.Group className="radio-stack">
              <Radio value="balance">Solde · {fmt(b?.balance)}</Radio>
              <Radio value="booked" disabled={b?.booked == null}>Solde comptable · {fmt(b?.booked)}</Radio>
              <Radio value="instant" disabled={b?.instant == null}>Solde instantané · {fmt(b?.instant)}</Radio>
            </Radio.Group>
          </Form.Item>
        )}
        {account.type === 'card' || !account.isManual ? (
          <Form.Item name="ignoreDeferredCard" valuePropName="checked">
            <Checkbox>Ignorer les cumuls de carte à débit différé</Checkbox>
          </Form.Item>
        ) : null}
        <Form.Item
          name="isDefaultForCommitments"
          valuePropName="checked"
          extra={account.isActive ? 'Les factures sans compte précisé seront rattachées à ce compte.' : 'Indisponible : ce compte est exclu de la trésorerie. Incluez-le d’abord.'}
        >
          <Checkbox disabled={!account.isActive}>Compte par défaut des factures</Checkbox>
        </Form.Item>
      </Form>
    </Drawer>
  );
}

function ManualAccountModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { message } = App.useApp();
  const load = useStore((s) => s.load);
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  return (
    <Modal
      open={open}
      onCancel={onClose}
      title="Créer un compte manuel"
      okText="Créer le compte"
      cancelText="Annuler"
      confirmLoading={saving}
      destroyOnHidden
      onOk={async () => {
        const v = await form.validateFields();
        setSaving(true);
        try {
          await api('POST', '/bank-accounts', { name: v.name.trim(), openingBalance: v.openingBalance ?? 0, openingDate: (v.openingDate as Dayjs).format('YYYY-MM-DD'), type: v.type });
          await load();
          message.success('Compte créé');
          form.resetFields();
          onClose();
        } catch (e) {
          message.error(errMsg(e, "Le compte n'a pas pu être créé."));
        } finally {
          setSaving(false);
        }
      }}
    >
      <p className="muted">Pour une caisse ou une banque non couverte. Vous y saisirez les opérations à la main ou par import de fichier.</p>
      <Form form={form} layout="vertical" requiredMark={false} initialValues={{ openingBalance: 0, openingDate: dayjs().startOf('month'), type: 'cash' }}>
        <Form.Item name="name" label="Nom du compte" rules={[{ required: true, whitespace: true, message: 'Donnez un nom au compte.' }]}>
          <Input maxLength={80} placeholder="Ex. : Caisse du magasin" />
        </Form.Item>
        <Form.Item name="type" label="Type">
          <Radio.Group>
            <Radio value="cash">Caisse</Radio>
            <Radio value="checking">Compte bancaire</Radio>
            <Radio value="savings">Épargne</Radio>
          </Radio.Group>
        </Form.Item>
        <div className="inline-row">
          <Form.Item name="openingBalance" label="Solde d'ouverture">
            <InputNumber<number> precision={2} decimalSeparator="," addonAfter="€" style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="openingDate" label="Au" rules={[{ required: true }]}>
            <DatePicker format="DD/MM/YYYY" style={{ width: '100%' }} />
          </Form.Item>
        </div>
      </Form>
    </Modal>
  );
}

/** Banques (écran 7.10). */
export function BanksTab() {
  const { message, modal } = App.useApp();
  const connections = useStore((s) => s.connections);
  const accounts = useStore((s) => s.accounts);
  const company = useStore((s) => s.company);
  const role = useStore((s) => s.role);
  const load = useStore((s) => s.load);
  const admin = canAdmin(role);
  const [providers, setProviders] = useState<{ demo: boolean; bridge: boolean } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<BankAccount | null>(null);
  const [manual, setManual] = useState(false);

  useEffect(() => {
    api<{ demo: boolean; bridge: boolean }>('GET', '/bank-providers').then(setProviders).catch(() => setProviders({ demo: true, bridge: false }));
  }, []);

  const link = async (provider: 'demo' | 'bridge', connectionId?: string) => {
    setBusy(connectionId ?? provider);
    try {
      const res = await api<{ redirectUrl?: string; imported?: number }>('POST', '/bank-connections/link', { provider, connectionId });
      if (res.redirectUrl) {
        window.location.assign(res.redirectUrl);
        return;
      }
      await load();
      message.success(`Banque connectée · ${res.imported ?? 0} opérations récupérées`);
    } catch (e) {
      message.error(errMsg(e, 'La connexion bancaire a échoué.'), 8);
    } finally {
      setBusy(null);
    }
  };

  const sync = async (id: string) => {
    setBusy(id);
    try {
      const res = await api<{ imported: number }>('POST', `/bank-connections/${encodeURIComponent(id)}/sync`);
      await load();
      message.success(res.imported ? `${res.imported} nouvelle${res.imported > 1 ? 's' : ''} opération${res.imported > 1 ? 's' : ''}` : 'Déjà à jour');
    } catch (e) {
      message.error(errMsg(e, 'La synchronisation a échoué.'));
    } finally {
      setBusy(null);
    }
  };

  const toggle = async (a: BankAccount, isActive: boolean) => {
    try {
      await api('PATCH', `/bank-accounts/${encodeURIComponent(a.id)}`, { isActive });
      await load();
    } catch (e) {
      message.error(errMsg(e, "Le compte n'a pas pu être modifié."));
    }
  };

  const groups: { key: string; title: string; connection?: BankConnection; accounts: BankAccount[] }[] = [
    ...connections.map((c) => ({ key: c.id, title: c.bankName, connection: c, accounts: accounts.filter((a) => a.connectionId === c.id) })),
  ];
  const manualAccounts = accounts.filter((a) => a.isManual);
  const others = accounts.filter((a) => !a.isManual && !connections.some((c) => c.id === a.connectionId));
  if (others.length) groups.push({ key: 'others', title: company?.isDemo ? 'Comptes de démonstration' : 'Comptes déconnectés', accounts: others });
  if (manualAccounts.length) groups.push({ key: 'manual', title: 'Comptes manuels', accounts: manualAccounts });

  return (
    <div className="settings-section banks">
      {company?.isDemo && (
        <Alert type="info" showIcon message="Vous explorez des données de démonstration." description="Connectez la banque de démonstration ci-dessous pour essayer la synchronisation, ou créez une société à votre nom depuis « Mes sociétés »." />
      )}
      {!admin && <Alert type="info" showIcon message="Seuls les administrateurs peuvent connecter des banques et régler les comptes." />}

      {groups.length === 0 && (
        <div className="bank-empty">
          <BankOutlined aria-hidden="true" />
          <p>Aucune banque connectée. Connectez votre banque pour que vos opérations arrivent automatiquement, 4 fois par jour.</p>
        </div>
      )}

      {groups.map((g) => (
        <section key={g.key} className="bank-card" aria-label={g.title}>
          <header className="bank-head">
            <span className="bank-logo" aria-hidden="true">{g.key === 'manual' ? <WalletOutlined /> : <BankOutlined />}</span>
            <div className="bank-title">
              <strong>{g.title}</strong>
              {g.connection && <StatusTag c={g.connection} onRepair={() => link(g.connection!.provider, g.connection!.id)} onRetry={() => sync(g.connection!.id)} />}
            </div>
            {g.connection && admin && (
              <div className="bank-tools">
                <Tooltip title="Synchroniser maintenant">
                  <Button type="text" icon={<SyncOutlined spin={busy === g.connection.id} />} aria-label={`Synchroniser ${g.title}`} onClick={() => sync(g.connection!.id)} />
                </Tooltip>
                <Dropdown
                  menu={{
                    items: [
                      { key: 'manage', label: "Gérer l'accès" },
                      { key: 'disconnect', label: 'Déconnecter', danger: true },
                    ],
                    onClick: ({ key }) => {
                      if (key === 'manage') return link(g.connection!.provider, g.connection!.id);
                      modal.confirm({
                        title: `Déconnecter ${g.title} ?`,
                        content: 'Vos opérations passées et leurs catégories sont conservées. Les comptes ne seront plus synchronisés.',
                        okText: 'Déconnecter',
                        okButtonProps: { danger: true },
                        cancelText: 'Annuler',
                        onOk: async () => {
                          await api('DELETE', `/bank-connections/${encodeURIComponent(g.connection!.id)}`);
                          await load();
                          message.success('Banque déconnectée');
                        },
                      });
                    },
                  }}
                >
                  <Button type="text" icon={<MoreOutlined />} aria-label={`Options de ${g.title}`} />
                </Dropdown>
              </div>
            )}
          </header>
          <ul className="bank-accounts">
            {g.accounts.map((a) => (
              <li key={a.id} className={a.isActive ? '' : 'is-off'}>
                <Switch
                  checked={a.isActive}
                  disabled={!admin}
                  onChange={(v) => toggle(a, v)}
                  aria-label={`Inclure ${accountLabel(a)} dans la trésorerie`}
                />
                <div className="bank-account-name">
                  <strong>{accountLabel(a)}</strong>
                  <span className="muted">
                    {typeLabels[a.type ?? 'other']}
                    {a.ibanMasked ? ` · ${a.ibanMasked}` : ''}
                    {!a.isActive && ' · exclu de la trésorerie'}
                  </span>
                </div>
                {a.isDefaultForCommitments && <Tag color="blue">Par défaut pour les factures</Tag>}
                <strong className={`num${a.balance < 0 ? ' negative' : ''}`}>{formatEuro(a.balance)}</strong>
                {admin && <Button type="text" icon={<EditOutlined />} aria-label={`Régler ${accountLabel(a)}`} onClick={() => setEditing(a)} />}
              </li>
            ))}
          </ul>
        </section>
      ))}

      {admin && (
        <div className="bank-add">
          {providers === null ? (
            <Spin size="small" />
          ) : (
            <>
              {providers.bridge && (
                <Button type="primary" icon={<PlusOutlined />} loading={busy === 'bridge'} onClick={() => link('bridge')}>
                  Connecter une banque
                </Button>
              )}
              <Button type={providers.bridge ? 'default' : 'primary'} icon={<BankOutlined />} loading={busy === 'demo'} onClick={() => link('demo')}>
                Connecter la banque de démonstration
              </Button>
              <Button icon={<WalletOutlined />} onClick={() => setManual(true)}>
                Créer un compte manuel
              </Button>
            </>
          )}
        </div>
      )}
      {providers && !providers.bridge && admin && (
        <p className="muted bank-note">
          La connexion à votre vraie banque sera disponible dès que l'agrégateur Bridge sera configuré sur le serveur (identifiants à demander à Bridge). En attendant, la banque de démonstration permet d'essayer tout le parcours.
        </p>
      )}

      <AccountDrawer account={editing} onClose={() => setEditing(null)} />
      <ManualAccountModal open={manual} onClose={() => setManual(false)} />
    </div>
  );
}

/** Retour de l'agrégateur après connexion (`/parametres/banques/retour?item_id=…&success=true`). */
export function BankCallbackPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const load = useStore((s) => s.load);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const itemId = params.get('item_id');
    const success = params.get('success') !== 'false';
    if (!itemId) {
      setError("Le retour de votre banque est incomplet. Recommencez la connexion depuis Paramètres > Banques.");
      return;
    }
    api('POST', '/bank-connections/callback', { provider: 'bridge', itemId, success })
      .then(() => load())
      .then(() => navigate('/parametres?onglet=banques', { replace: true }))
      .catch((e: unknown) => setError(errMsg(e, "La connexion bancaire ne s'est pas terminée.")));
  }, [params, load, navigate]);
  return (
    <section className="card" style={{ maxWidth: 560 }}>
      {error ? (
        <>
          <Alert type="error" showIcon message={error} />
          <Button style={{ marginTop: 16 }} onClick={() => navigate('/parametres?onglet=banques')}>Retour aux banques</Button>
        </>
      ) : (
        <p role="status">
          <Spin size="small" /> Un petit moment… Nous récupérons vos comptes et vos opérations. Cela peut prendre plus d'une minute.
        </p>
      )}
    </section>
  );
}
