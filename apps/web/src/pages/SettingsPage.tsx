import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Alert, App, Button, Form, Input, InputNumber, Modal, Popconfirm, Radio, Select, Switch, Table, Tabs, Tag } from 'antd';
import { formatDate } from '@optimum/treso-engine';
import { api, ApiError } from '../api/client';
import { useSession } from '../api/session';
import { canAdmin, roleOptions, type Member, type PendingInvitation, type Role } from '../api/types';
import { useStore, type ThemePref } from '../store/useStore';
import { BanksTab } from './settings/BanksTab';
import { ImportsTab } from './settings/ImportsTab';
import { RulesTab } from './settings/RulesTab';
import './settings.css';

const errMsg = (e: unknown) => (e instanceof ApiError ? e.message : "L'enregistrement a échoué.");

function CompanyTab() {
  const { message } = App.useApp();
  const company = useStore((s) => s.company)!;
  const settings = useStore((s) => s.settings);
  const role = useStore((s) => s.role);
  const updateSettings = useStore((s) => s.updateSettings);
  const reloadMe = useSession((s) => s.reloadMe);
  const clear = useStore((s) => s.clear);
  const navigate = useNavigate();
  const admin = canAdmin(role);
  const [deleting, setDeleting] = useState(false);
  const [confirmName, setConfirmName] = useState('');

  const save = async (patch: Parameters<typeof updateSettings>[0]) => {
    try {
      await updateSettings(patch);
      message.success('Enregistré');
    } catch (e) {
      message.error(errMsg(e));
    }
  };

  return (
    <div className="settings-section">
      {!admin && <Alert type="info" showIcon message="Seuls les administrateurs peuvent modifier ces réglages." />}
      <Form layout="vertical" disabled={!admin} requiredMark={false} initialValues={{ name: company.name, ...settings }}>
        <Form.Item name="name" label="Nom de l'entreprise" rules={[{ required: true }]}>
          <Input onBlur={(e) => e.target.value.trim() && e.target.value !== company.name && save({ name: e.target.value.trim() })} />
        </Form.Item>
        <Form.Item
          name="minCashThreshold"
          label="Seuil de trésorerie minimum"
          extra="Votre découvert autorisé, ou le niveau sous lequel vous voulez être alerté."
        >
          <InputNumber<number>
            min={0}
            step={1000}
            addonAfter="€"
            style={{ width: 220 }}
            formatter={(v) => (v === undefined || v === null || String(v) === '' ? '' : Number(v).toLocaleString('fr-FR'))}
            parser={(v) => Number((v ?? '').replace(/\s| /g, ''))}
            onBlur={(e) => {
              const n = Number(e.target.value.replace(/\s| /g, ''));
              if (Number.isFinite(n) && n !== settings.minCashThreshold) save({ minCashThreshold: n });
            }}
          />
        </Form.Item>
        <Form.Item name="forecastMode" label="Mode du plan de trésorerie">
          <Radio.Group onChange={(e) => save({ forecastMode: e.target.value })}>
            <Radio value="projection">Projection — les budgets ajustés des dépassements déjà constatés (recommandé)</Radio>
            <Radio value="budget">Budget — les budgets tels que saisis</Radio>
          </Radio.Group>
        </Form.Item>
        <Form.Item name="overdueInPlan" label="Factures en retard dans le plan">
          <Radio.Group onChange={(e) => save({ overdueInPlan: e.target.value })}>
            <Radio value="current_month">Reportées au mois courant (recommandé)</Radio>
            <Radio value="due_month">Laissées dans leur mois d'échéance</Radio>
          </Radio.Group>
        </Form.Item>
        <Form.Item name="invoicesEnabled" label="Factures engagées" valuePropName="checked" extra="Intégrer vos factures à venir dans la trésorerie prévisionnelle.">
          <Switch onChange={(v) => save({ invoicesEnabled: v })} />
        </Form.Item>
        <Form.Item label="Exclusions automatiques" extra="Ces opérations ne faussent plus vos totaux ; vous pouvez toujours les réintégrer une à une.">
          <div className="radio-stack">
            <label className="switch-line">
              <Form.Item name="autoHideRefunds" valuePropName="checked" noStyle>
                <Switch onChange={(v) => save({ autoHideRefunds: v })} />
              </Form.Item>
              Exclure les remboursements (achat puis remboursement du même montant)
            </label>
            <label className="switch-line">
              <Form.Item name="autoHideInternalTransfers" valuePropName="checked" noStyle>
                <Switch onChange={(v) => save({ autoHideInternalTransfers: v })} />
              </Form.Item>
              Exclure les virements entre mes comptes
            </label>
          </div>
        </Form.Item>
        <Form.Item label="Estimation de la TVA">
          <div className="inline-row">
            <Form.Item name="vatEnabled" valuePropName="checked" noStyle>
              <Switch onChange={(v) => save({ vatEnabled: v })} />
            </Form.Item>
            <Form.Item name="vatRegime" noStyle>
              <Select
                style={{ width: 200 }}
                onChange={(v) => save({ vatRegime: v })}
                options={[
                  { value: 'monthly', label: 'Régime mensuel' },
                  { value: 'quarterly', label: 'Régime trimestriel' },
                ]}
              />
            </Form.Item>
          </div>
        </Form.Item>
      </Form>

      {role === 'OWNER' && (
        <div className="danger-zone">
          <h3>Zone sensible</h3>
          <p className="muted">Supprimer la société efface toutes ses données. Les utilisateurs perdront l'accès.</p>
          <Button danger onClick={() => setDeleting(true)}>Supprimer la société</Button>
          <Modal
            open={deleting}
            title={`Supprimer ${company.name} ?`}
            okText="Supprimer définitivement"
            okButtonProps={{ danger: true, disabled: confirmName !== company.name }}
            cancelText="Annuler"
            onCancel={() => setDeleting(false)}
            onOk={async () => {
              try {
                await api('DELETE', '/companies/current', { confirmName });
                clear();
                const me = await reloadMe();
                message.success('Société supprimée.');
                navigate(me?.companies.length ? '/societes' : '/bienvenue');
              } catch (e) {
                message.error(errMsg(e));
              }
            }}
          >
            <p>Cette action est définitive. Saisissez le nom de l'entreprise pour confirmer :</p>
            <Input value={confirmName} onChange={(e) => setConfirmName(e.target.value)} placeholder={company.name} />
          </Modal>
        </div>
      )}
    </div>
  );
}

function ProfileTab() {
  const { message } = App.useApp();
  const me = useSession((s) => s.me)!;
  const reloadMe = useSession((s) => s.reloadMe);
  const theme = useStore((s) => s.theme);
  const setTheme = useStore((s) => s.setTheme);
  return (
    <div className="settings-section">
      <Form
        layout="vertical"
        initialValues={{ firstName: me.firstName, lastName: me.lastName ?? '' }}
        requiredMark={false}
        onFinish={async (v: { firstName: string; lastName: string }) => {
          try {
            await api('PATCH', '/me', { firstName: v.firstName, lastName: v.lastName || null });
            await reloadMe();
            message.success('Profil enregistré');
          } catch (e) {
            message.error(errMsg(e));
          }
        }}
      >
        <Form.Item label="Adresse email">
          <Input value={me.email} disabled />
        </Form.Item>
        <div className="inline-row">
          <Form.Item name="firstName" label="Prénom" rules={[{ required: true, message: 'Indiquez votre prénom.' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="lastName" label="Nom">
            <Input />
          </Form.Item>
        </div>
        <Form.Item label="Thème">
          <Radio.Group value={theme} onChange={(e) => setTheme(e.target.value as ThemePref)} optionType="button">
            <Radio value="system">Automatique</Radio>
            <Radio value="light">Clair</Radio>
            <Radio value="dark">Sombre</Radio>
          </Radio.Group>
        </Form.Item>
        <Button type="primary" htmlType="submit">Enregistrer</Button>
      </Form>
    </div>
  );
}

function UsersTab() {
  const { message, modal } = App.useApp();
  const role = useStore((s) => s.role);
  const admin = canAdmin(role);
  const [data, setData] = useState<{ members: Member[]; invitations: PendingInvitation[] } | null>(null);
  const [invite] = Form.useForm();
  const [devLink, setDevLink] = useState<string | null>(null);
  const refresh = useCallback(() => api<{ members: Member[]; invitations: PendingInvitation[] }>('GET', '/memberships').then(setData), []);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="settings-section">
      {admin && (
        <Form
          form={invite}
          layout="inline"
          className="invite-form"
          initialValues={{ role: 'EDITOR' }}
          onFinish={async (v: { email: string; role: Role }) => {
            try {
              const res = await api<{ message: string; devLink?: string }>('POST', '/invitations', v);
              message.success(res.message);
              setDevLink(res.devLink ?? null);
              invite.resetFields(['email']);
              void refresh();
            } catch (e) {
              message.error(errMsg(e));
            }
          }}
        >
          <Form.Item name="email" rules={[{ required: true, type: 'email', message: 'Adresse email invalide.' }]}>
            <Input placeholder="Adresse email" aria-label="Adresse email de la personne à inviter" style={{ width: 260 }} />
          </Form.Item>
          <Form.Item name="role">
            <Select style={{ width: 220 }} aria-label="Rôle" options={roleOptions.map((r) => ({ value: r.value, label: r.label, title: r.help }))} />
          </Form.Item>
          <Button type="primary" htmlType="submit">Inviter</Button>
        </Form>
      )}
      {devLink && (
        <p className="dev-link">
          Mode développement — lien d'invitation : <a href={devLink.replace(/^https?:\/\/[^/]+/, '')}>{devLink.replace(/^https?:\/\/[^/]+/, '')}</a>
        </p>
      )}
      <ul className="role-help">
        {roleOptions.map((r) => (
          <li key={r.value}><strong>{r.label}</strong> : {r.help}</li>
        ))}
      </ul>
      <Table<Member>
        rowKey="userId"
        loading={!data}
        dataSource={data?.members ?? []}
        pagination={false}
        columns={[
          { title: 'Nom', dataIndex: 'name', render: (n: string, m) => <>{n}{m.isMe && <Tag style={{ marginLeft: 8 }}>Vous</Tag>}</> },
          { title: 'Email', dataIndex: 'email' },
          {
            title: 'Rôle',
            dataIndex: 'role',
            render: (r: Role, m) =>
              admin && r !== 'OWNER' && !m.isMe ? (
                <Select
                  value={r}
                  style={{ width: 200 }}
                  aria-label={`Rôle de ${m.name}`}
                  options={roleOptions.map((o) => ({ value: o.value, label: o.label }))}
                  onChange={async (v) => {
                    try {
                      await api('PATCH', `/memberships/${m.userId}`, { role: v });
                      message.success('Rôle mis à jour');
                      void refresh();
                    } catch (e) {
                      message.error(errMsg(e));
                    }
                  }}
                />
              ) : (
                m.roleLabel
              ),
          },
          {
            title: '',
            key: 'actions',
            render: (_, m) =>
              admin && m.role !== 'OWNER' && !m.isMe ? (
                <Button
                  type="link"
                  danger
                  onClick={() =>
                    modal.confirm({
                      title: `Retirer ${m.name} ?`,
                      content: "Cette personne perdra l'accès à la société.",
                      okText: 'Retirer',
                      okButtonProps: { danger: true },
                      cancelText: 'Annuler',
                      onOk: async () => {
                        await api('DELETE', `/memberships/${m.userId}`).catch((e) => message.error(errMsg(e)));
                        void refresh();
                      },
                    })
                  }
                >
                  Retirer
                </Button>
              ) : null,
          },
        ]}
      />
      {admin && !!data?.invitations.length && (
        <>
          <h3 style={{ marginTop: 24 }}>Invitations en attente</h3>
          <Table<PendingInvitation>
            rowKey="id"
            dataSource={data.invitations}
            pagination={false}
            columns={[
              { title: 'Email', dataIndex: 'email' },
              { title: 'Rôle', dataIndex: 'roleLabel' },
              { title: 'Expire le', dataIndex: 'expiresAt', render: (d: string) => formatDate(d.slice(0, 10)) },
              {
                title: '',
                key: 'x',
                render: (_, i) => (
                  <Popconfirm title="Annuler cette invitation ?" okText="Oui" cancelText="Non" onConfirm={() => api('DELETE', `/invitations/${i.id}`).then(refresh)}>
                    <Button type="link">Annuler</Button>
                  </Popconfirm>
                ),
              },
            ]}
          />
        </>
      )}
    </div>
  );
}

interface AuditEntry {
  id: number;
  action: string;
  entity: string;
  entityId: string | null;
  at: string;
  actor: string | null;
}

const entityLabels: Record<string, string> = {
  bank_connection: 'Connexion bancaire',
  bank_account: 'Compte',
  transaction: 'Opération',
  import: 'Import',
  rules_order: 'Ordre des règles',
  budgets: 'Budgets',
  scenario: 'Scénario',
  transactions: 'Opérations',
  reconciliation: 'Rapprochement',
  rule: 'Règle',
  company: 'Paramètres de la société',
  membership: 'Membre',
  invitation: 'Invitation',
  commitment: 'Facture',
};
const actionLabels: Record<string, string> = {
  create: 'Création',
  update: 'Modification',
  delete: 'Suppression',
  sync: 'Synchronisation',
  split: 'Division',
  unsplit: 'Division annulée',
  import: 'Import',
  apply: 'Application de règle',
};

function AuditTab() {
  const [rows, setRows] = useState<AuditEntry[] | null>(null);
  useEffect(() => {
    api<AuditEntry[]>('GET', '/audit-logs?limit=100').then(setRows).catch(() => setRows([]));
  }, []);
  return (
    <Table<AuditEntry>
      rowKey="id"
      loading={!rows}
      dataSource={rows ?? []}
      pagination={{ pageSize: 20 }}
      columns={[
        { title: 'Date', dataIndex: 'at', render: (d: string) => new Date(d).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) },
        { title: 'Qui', dataIndex: 'actor', render: (a: string | null) => a ?? '—' },
        { title: 'Action', dataIndex: 'action', render: (a: string) => actionLabels[a] ?? a },
        { title: 'Élément', dataIndex: 'entity', render: (e: string, r) => `${entityLabels[e] ?? e}${r.entityId && e !== 'budgets' ? ` · ${r.entityId}` : ''}` },
      ]}
    />
  );
}

export function SettingsPage() {
  const role = useStore((s) => s.role);
  const [params, setParams] = useSearchParams();
  const tab = params.get('onglet') ?? 'societe';
  return (
    <section className="card">
      <Tabs
        activeKey={tab}
        onChange={(k) => setParams({ onglet: k })}
        items={[
          { key: 'societe', label: 'Société', children: <CompanyTab /> },
          { key: 'profil', label: 'Mon profil', children: <ProfileTab /> },
          { key: 'utilisateurs', label: 'Utilisateurs', children: <UsersTab /> },
          { key: 'banques', label: 'Banques', children: <BanksTab /> },
          { key: 'regles', label: 'Règles', children: <RulesTab /> },
          { key: 'imports', label: 'Imports', children: <ImportsTab /> },
          ...(canAdmin(role) ? [{ key: 'journal', label: "Journal d'activité", children: <AuditTab /> }] : []),
        ]}
      />
    </section>
  );
}
