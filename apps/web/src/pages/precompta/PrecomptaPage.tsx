/**
 * Pré-comptabilité (écran 7.16) : flux À traiter → À vérifier → Prêtes à
 * envoyer → Envoyées, vérification des écritures, configuration, export FEC.
 */
import { useMemo, useState } from 'react';
import { Alert, App, Button, DatePicker, Empty, Input, Modal, Radio, Select, Spin, Table, Tabs, Tag } from 'antd';
import { CheckOutlined, DownloadOutlined, SendOutlined, ThunderboltOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import {
  formatDate,
  formatEuro,
  LEDGER_TYPE_LABELS,
  monthOf,
  pendingSources,
  suggestAccount,
  VAT_RATES,
  type Entry,
  type FecResult,
  type LedgerType,
} from '@optimum/treso-engine';
import { useStore } from '../../store/useStore';
import { api, ApiError } from '../../api/client';
import { canWrite } from '../../api/types';
import { downloadBlob } from '../../components/spreadsheet';
import { EntryDrawer, STATUS } from './EntryDrawer';
import { usePrecompta, type PrecomptaData, type PrecomptaSettings } from './usePrecompta';
import './precompta.css';

const total = (e: Entry) => e.lines.reduce((s, l) => s + l.debit, 0);

export function PrecomptaPage() {
  const { data, error, reload, setEntries } = usePrecompta();
  const [tab, setTab] = useState('flux');
  if (error) return <Alert type="error" showIcon message={error} />;
  if (!data) return <Spin />;
  return (
    <div className="precompta">
      <Tabs
        activeKey={tab}
        onChange={setTab}
        items={[
          { key: 'flux', label: 'Écritures', children: <Flow data={data} reload={reload} setEntries={setEntries} /> },
          { key: 'config', label: 'Configuration', children: <Config data={data} reload={reload} /> },
        ]}
      />
    </div>
  );
}

function Flow({ data, reload, setEntries }: { data: PrecomptaData; reload: () => Promise<void>; setEntries: (e: Entry[]) => void }) {
  const { message, modal } = App.useApp();
  const s = useStore();
  const mayEdit = canWrite(s.role);
  const fyStart = Number(s.settings.fiscalYearStartMonth ?? 1);
  const now = dayjs(s.today);
  const start = now.month() + 1 >= fyStart ? now.month(fyStart - 1).startOf('month') : now.subtract(1, 'year').month(fyStart - 1).startOf('month');
  const [range, setRange] = useState<[string, string]>([start.format('YYYY-MM-DD'), s.today]);
  const [open, setOpen] = useState<Entry | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [fecOpen, setFecOpen] = useState(false);

  const inRange = data.entries.filter((e) => e.date >= range[0] && e.date <= range[1]);
  const pending = useMemo(() => pendingSources(s.commitments, s.transactions, data.entries, range[0], range[1]), [s.commitments, s.transactions, data.entries, range]);
  const pendingCount = pending.commitments.length + pending.transactions.length;
  const col = (st: Entry['status'][]) => inRange.filter((e) => st.includes(e.status));
  const drafts = col(['draft', 'rejected']);
  const ready = col(['validated']);
  const sent = col(['sent']);
  const month = monthOf(s.today);
  const kpis = [
    { label: 'Écritures du mois', value: data.entries.filter((e) => monthOf(e.date) === month).length },
    { label: 'Brouillons', value: drafts.length },
    { label: 'Validées', value: ready.length },
    { label: 'Envoyées', value: sent.length },
    { label: 'Refusées', value: col(['rejected']).length },
  ];

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try {
      await fn();
    } catch (e) {
      message.error(e instanceof ApiError ? e.message : 'Action impossible.');
    } finally {
      setBusy(null);
    }
  };

  const generate = () =>
    run('generate', async () => {
      const r = await api<{ generated: number; entries: Entry[] }>('POST', '/precompta/generate', { from: range[0], to: range[1] });
      setEntries(r.entries);
      message.success(`${r.generated} écriture${r.generated > 1 ? 's' : ''} proposée${r.generated > 1 ? 's' : ''}`);
    });

  const validateAll = () =>
    run('validate', async () => {
      const r = await api<{ validated: number; refused: { id: string; errors: string[] }[]; entries: Entry[] }>('POST', '/precompta/entries/validate', { ids: drafts.filter((e) => e.status === 'draft').map((e) => e.id) });
      setEntries(r.entries);
      if (r.refused.length) message.warning(`${r.validated} écriture${r.validated > 1 ? 's' : ''} validée${r.validated > 1 ? 's' : ''} · ${r.refused.length} à corriger (déséquilibre ou compte inconnu)`);
      else message.success(`${r.validated} écriture${r.validated > 1 ? 's' : ''} validée${r.validated > 1 ? 's' : ''}`);
    });

  const sendAll = () => {
    const direct = data.settings.provider === 'demo';
    modal.confirm({
      title: direct ? `Envoyer ${ready.length} écriture${ready.length > 1 ? 's' : ''} ?` : 'Marquer comme envoyées',
      content: direct
        ? 'Les écritures sont transmises au logiciel comptable de démonstration.'
        : `La connexion directe à ${data.settings.software || 'votre logiciel'} n’est pas encore disponible : téléchargez d’abord le FEC et transmettez-le à votre cabinet, puis marquez les écritures comme envoyées.`,
      okText: direct ? 'Envoyer' : 'Marquer comme envoyées',
      cancelText: 'Annuler',
      onOk: () =>
        run('send', async () => {
          const r = await api<{ sent: number; entries: Entry[] }>('POST', '/precompta/entries/send', { ids: ready.map((e) => e.id) });
          setEntries(r.entries);
          message.success(`${r.sent} écriture${r.sent > 1 ? 's' : ''} envoyée${r.sent > 1 ? 's' : ''}`);
        }),
    });
  };

  const card = (e: Entry) => (
    <li key={e.id}>
      <button type="button" className="entry-card" onClick={() => setOpen(e)}>
        <span className="entry-card-top">
          <span className="muted">
            {formatDate(e.date)} · {e.journal}
            {e.number ? ` n° ${e.number}` : ''}
          </span>
          {e.status === 'rejected' && <Tag color="red">Refusée</Tag>}
        </span>
        <strong className="ellipsis">{e.label}</strong>
        <span className="num">{formatEuro(total(e))}</span>
      </button>
    </li>
  );

  return (
    <div className="precompta-flow">
      <div className="precompta-toolbar">
        <DatePicker.RangePicker
          format="DD/MM/YYYY"
          allowClear={false}
          value={[dayjs(range[0]), dayjs(range[1])]}
          onChange={(v) => v?.[0] && v[1] && setRange([v[0].format('YYYY-MM-DD'), v[1].format('YYYY-MM-DD')])}
          aria-label="Période"
        />
        <span className="spacer" />
        <Button icon={<DownloadOutlined />} onClick={() => setFecOpen(true)}>
          Export FEC
        </Button>
      </div>

      <section className="kpi-grid precompta-kpis">
        {kpis.map((k) => (
          <div key={k.label} className="card kpi">
            <div className="eyebrow">{k.label}</div>
            <div className="kpi-value num">{k.value}</div>
          </div>
        ))}
      </section>

      <section className="kanban">
        <div className="kanban-col">
          <header>
            <h3>À traiter</h3>
            <span className="count">{pendingCount}</span>
          </header>
          <p className="muted">
            {pending.commitments.length} facture{pending.commitments.length > 1 ? 's' : ''} et {pending.transactions.length} opération{pending.transactions.length > 1 ? 's' : ''} sans écriture sur la période.
          </p>
          {mayEdit && (
            <Button type="primary" icon={<ThunderboltOutlined />} disabled={!pendingCount} loading={busy === 'generate'} onClick={generate} block>
              Générer les écritures
            </Button>
          )}
        </div>
        <div className="kanban-col">
          <header>
            <h3>À vérifier</h3>
            <span className="count">{drafts.length}</span>
          </header>
          {mayEdit && drafts.some((e) => e.status === 'draft') && (
            <Button icon={<CheckOutlined />} loading={busy === 'validate'} onClick={validateAll} block>
              Vérifier en série
            </Button>
          )}
          <ul className="entry-list">{drafts.slice(0, 200).map(card)}</ul>
          {drafts.length === 0 && <p className="muted">Rien à vérifier.</p>}
        </div>
        <div className="kanban-col">
          <header>
            <h3>Prêtes à envoyer</h3>
            <span className="count">{ready.length}</span>
          </header>
          {mayEdit && ready.length > 0 && (
            <Button icon={<SendOutlined />} loading={busy === 'send'} onClick={sendAll} block>
              {data.settings.provider === 'demo' ? 'Envoyer en série' : 'Marquer comme envoyées'}
            </Button>
          )}
          <ul className="entry-list">{ready.slice(0, 200).map(card)}</ul>
        </div>
        <div className="kanban-col">
          <header>
            <h3>Envoyées</h3>
            <span className="count">{sent.length}</span>
          </header>
          <ul className="entry-list">{sent.slice(0, 200).map(card)}</ul>
        </div>
      </section>

      <EntryDrawer
        entry={open}
        chart={data.chart}
        onClose={() => setOpen(null)}
        onChanged={(entries) => (entries ? setEntries(entries) : void reload())}
      />
      <FecModal open={fecOpen} defaultRange={range} onClose={() => setFecOpen(false)} />
    </div>
  );
}

function FecModal({ open, defaultRange, onClose }: { open: boolean; defaultRange: [string, string]; onClose: () => void }) {
  const { message } = App.useApp();
  const [range, setRange] = useState(defaultRange);
  const [closing, setClosing] = useState(dayjs(defaultRange[0]).add(11, 'month').endOf('month').format('YYYY-MM-DD'));
  const [result, setResult] = useState<FecResult | null>(null);
  const [loading, setLoading] = useState(false);

  const check = async () => {
    setLoading(true);
    try {
      setResult(await api<FecResult>('GET', `/precompta/fec?from=${range[0]}&to=${range[1]}&closing=${closing}`));
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Contrôle impossible.');
    } finally {
      setLoading(false);
    }
  };

  const download = async () => {
    if (!result) return;
    const { zipSync, strToU8 } = await import('fflate');
    const zip = zipSync({ [result.fileName]: strToU8(result.content) });
    downloadBlob(result.fileName.replace('.txt', '.zip'), new Blob([zip], { type: 'application/zip' }));
    message.success('FEC téléchargé');
  };

  return (
    <Modal
      open={open}
      onCancel={() => {
        setResult(null);
        onClose();
      }}
      title="Export FEC"
      width={640}
      footer={[
        <Button key="c" onClick={check} loading={loading}>
          Contrôler
        </Button>,
        <Button key="d" type="primary" icon={<DownloadOutlined />} disabled={!result || result.errors.length > 0} onClick={download}>
          Télécharger
        </Button>,
      ]}
    >
      <div className="fec-form">
        <label>
          Période
          <DatePicker.RangePicker format="DD/MM/YYYY" allowClear={false} value={[dayjs(range[0]), dayjs(range[1])]} onChange={(v) => v?.[0] && v[1] && (setRange([v[0].format('YYYY-MM-DD'), v[1].format('YYYY-MM-DD')]), setResult(null))} />
        </label>
        <label>
          Date de clôture de l’exercice
          <DatePicker format="DD/MM/YYYY" allowClear={false} value={dayjs(closing)} onChange={(d) => d && (setClosing(d.format('YYYY-MM-DD')), setResult(null))} />
        </label>
        <p className="muted">
          Fichier des écritures comptables (article A47 A-1 du LPF) : 18 colonnes, séparateur « | », écritures validées et envoyées de la période. Le contrôle de conformité est obligatoire avant le téléchargement.
        </p>
        {result &&
          (result.errors.length ? (
            <Alert
              type="error"
              showIcon
              message={`${result.errors.length} point${result.errors.length > 1 ? 's' : ''} bloquant${result.errors.length > 1 ? 's' : ''}`}
              description={
                <ul className="import-errors">
                  {result.errors.slice(0, 10).map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
              }
            />
          ) : (
            <Alert type="success" showIcon message={`Conforme : ${result.entries} écritures, ${result.lines} lignes · ${result.fileName}`} />
          ))}
        {result && result.warnings.length > 0 && (
          <Alert
            type="warning"
            showIcon
            message="Points d’attention"
            description={
              <ul className="import-errors">
                {result.warnings.slice(0, 8).map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            }
          />
        )}
      </div>
    </Modal>
  );
}

// ───────────────────────── Configuration ─────────────────────────

function Config({ data, reload }: { data: PrecomptaData; reload: () => Promise<void> }) {
  return (
    <Tabs
      tabPosition="top"
      size="small"
      items={[
        { key: 'conn', label: 'Connexion comptable', children: <ConnectionTab settings={data.settings} reload={reload} /> },
        { key: 'chart', label: 'Plan de comptes', children: <ChartTab data={data} reload={reload} /> },
        { key: 'vat', label: 'TVA', children: <VatTab data={data} reload={reload} /> },
        { key: 'map', label: 'Correspondances', children: <MappingsTab data={data} reload={reload} /> },
        { key: 'journals', label: 'Journaux', children: <JournalsTab data={data} reload={reload} /> },
      ]}
    />
  );
}

function useSaveSettings(reload: () => Promise<void>) {
  const { message } = App.useApp();
  return async (patch: Partial<PrecomptaSettings>) => {
    try {
      await api('PUT', '/precompta/settings', patch);
      await reload();
      message.success('Enregistré');
    } catch (e) {
      message.error(e instanceof ApiError ? e.message : 'Enregistrement impossible.');
    }
  };
}

function ConnectionTab({ settings, reload }: { settings: PrecomptaSettings; reload: () => Promise<void> }) {
  const { message } = App.useApp();
  const save = useSaveSettings(reload);
  const [software, setSoftware] = useState(settings.software ?? '');
  const [dossier, setDossier] = useState(settings.dossierCode ?? '');
  return (
    <div className="config-pane">
      <label className="field">
        Logiciel comptable
        <Radio.Group
          value={settings.provider}
          onChange={(e) => save({ provider: e.target.value })}
          options={[
            { value: 'none', label: 'Aucun' },
            { value: 'other', label: 'Mon logiciel (export FEC)' },
            { value: 'demo', label: 'Démonstration' },
          ]}
        />
      </label>
      {settings.provider === 'other' && (
        <label className="field">
          Nom du logiciel
          <Input value={software} onChange={(e) => setSoftware(e.target.value)} onBlur={() => software !== (settings.software ?? '') && save({ software: software || null })} placeholder="Ex. : Quadra, Cegid, Sage, Inqom…" style={{ maxWidth: 360 }} />
        </label>
      )}
      <label className="field">
        Code dossier
        <Input value={dossier} onChange={(e) => setDossier(e.target.value)} onBlur={() => dossier !== (settings.dossierCode ?? '') && save({ dossierCode: dossier || null })} style={{ maxWidth: 200 }} />
      </label>
      <Button
        onClick={async () => {
          const r = await api<{ ok: boolean; message: string }>('POST', '/precompta/connection/test');
          (r.ok ? message.success : message.info)(r.message);
        }}
      >
        Tester la connexion
      </Button>
      <p className="muted">
        La connexion directe (plan de comptes, GED, envoi des écritures) arrive logiciel par logiciel. En attendant, l’export FEC est accepté par tous les logiciels comptables français.
      </p>
    </div>
  );
}

function ChartTab({ data, reload }: { data: PrecomptaData; reload: () => Promise<void> }) {
  const { message } = App.useApp();
  const [q, setQ] = useState('');
  const [type, setType] = useState<LedgerType | 'all'>('all');
  const [draft, setDraft] = useState({ number: '', label: '', type: 'expense' as LedgerType });
  const rows = data.chart.filter((a) => (type === 'all' || a.type === type) && (!q || `${a.number} ${a.label}`.toLowerCase().includes(q.toLowerCase())));
  return (
    <div className="config-pane">
      <div className="config-tools">
        <Input.Search placeholder="Rechercher un compte" value={q} onChange={(e) => setQ(e.target.value)} allowClear style={{ maxWidth: 280 }} />
        <Select value={type} onChange={setType} style={{ width: 170 }} options={[{ value: 'all', label: 'Tous les types' }, ...Object.entries(LEDGER_TYPE_LABELS).map(([v, l]) => ({ value: v, label: l }))]} />
      </div>
      <Table
        size="small"
        rowKey="number"
        dataSource={rows}
        pagination={{ pageSize: 15, hideOnSinglePage: true }}
        columns={[
          { title: 'Compte', dataIndex: 'number', width: 110 },
          { title: 'Libellé', dataIndex: 'label' },
          { title: 'Type', dataIndex: 'type', width: 130, render: (t: LedgerType) => LEDGER_TYPE_LABELS[t] },
          {
            title: 'Visible',
            width: 90,
            render: (_, a) => (
              <Button
                size="small"
                type="text"
                onClick={async () => {
                  await api('PATCH', `/precompta/accounts/${a.number}`, { hidden: !a.hidden });
                  await reload();
                }}
              >
                {a.hidden ? 'Masqué' : 'Visible'}
              </Button>
            ),
          },
        ]}
      />
      <div className="config-tools">
        <Input placeholder="Numéro (ex. 606300)" value={draft.number} onChange={(e) => setDraft({ ...draft, number: e.target.value.trim() })} style={{ width: 170 }} />
        <Input placeholder="Libellé" value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} style={{ maxWidth: 300 }} />
        <Select value={draft.type} onChange={(t) => setDraft({ ...draft, type: t })} style={{ width: 150 }} options={Object.entries(LEDGER_TYPE_LABELS).map(([v, l]) => ({ value: v, label: l }))} />
        <Button
          disabled={!/^\d{3,}/.test(draft.number) || !draft.label.trim()}
          onClick={async () => {
            try {
              await api('POST', '/precompta/accounts', draft);
              setDraft({ number: '', label: '', type: draft.type });
              await reload();
              message.success('Compte ajouté');
            } catch (e) {
              message.error(e instanceof Error ? e.message : 'Ajout impossible.');
            }
          }}
        >
          Ajouter le compte
        </Button>
      </div>
    </div>
  );
}

function VatTab({ data, reload }: { data: PrecomptaData; reload: () => Promise<void> }) {
  const save = useSaveSettings(reload);
  const vatAccounts = data.chart.filter((a) => a.type === 'vat').map((a) => ({ value: a.number, label: `${a.number} · ${a.label}` }));
  const rates = VAT_RATES.filter((r) => r > 0);
  const set = (kind: 'deductible' | 'collected', rate: number, acc: string) => save({ vat: { ...data.settings.vat, [kind]: { ...data.settings.vat[kind], [String(rate)]: acc } } });
  return (
    <div className="config-pane">
      <table className="mini-table vat-table">
        <thead>
          <tr>
            <th>Taux</th>
            <th>TVA déductible (achats)</th>
            <th>TVA collectée (ventes)</th>
          </tr>
        </thead>
        <tbody>
          {rates.map((r) => (
            <tr key={r}>
              <th>{r.toLocaleString('fr-FR')} %</th>
              <td>
                <Select value={data.settings.vat.deductible[String(r)]} options={vatAccounts} onChange={(v) => set('deductible', r, v)} style={{ width: 280 }} />
              </td>
              <td>
                <Select value={data.settings.vat.collected[String(r)]} options={vatAccounts} onChange={(v) => set('collected', r, v)} style={{ width: 280 }} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <label className="field">
        Compte d’attente (catégorie sans correspondance)
        <Select value={data.settings.suspense} onChange={(v) => save({ suspense: v })} style={{ width: 280 }} showSearch options={data.chart.map((a) => ({ value: a.number, label: `${a.number} · ${a.label}` }))} />
      </label>
    </div>
  );
}

function MappingsTab({ data, reload }: { data: PrecomptaData; reload: () => Promise<void> }) {
  const { message } = App.useApp();
  const s = useStore();
  const [onlyMissing, setOnlyMissing] = useState(false);
  const options = data.chart.filter((a) => !a.hidden).map((a) => ({ value: a.number, label: `${a.number} · ${a.label}` }));
  const rows = s.categories.filter((c) => !onlyMissing || !data.mappings[c.id]);
  const set = async (categoryId: string, account: string | null) => {
    await api('PUT', '/precompta/mappings', { items: [{ categoryId, account }] });
    await reload();
  };
  return (
    <div className="config-pane">
      <div className="config-tools">
        <Radio.Group value={onlyMissing} onChange={(e) => setOnlyMissing(e.target.value)} optionType="button" options={[{ value: false, label: 'Toutes' }, { value: true, label: 'Sans correspondance' }]} />
        <Button
          onClick={async () => {
            const items = s.categories.filter((c) => !data.mappings[c.id]).map((c) => ({ categoryId: c.id, account: suggestAccount(c) }));
            if (!items.length) return void message.info('Toutes les catégories ont une correspondance.');
            await api('PUT', '/precompta/mappings', { items });
            await reload();
            message.success(`${items.length} correspondance${items.length > 1 ? 's' : ''} enregistrée${items.length > 1 ? 's' : ''}`);
          }}
        >
          Accepter toutes les propositions
        </Button>
      </div>
      <Table
        size="small"
        rowKey="id"
        dataSource={rows}
        pagination={false}
        columns={[
          { title: 'Catégorie', dataIndex: 'name', render: (n: string, c) => <span>{n} <span className="muted">· {c.flow === 'in' ? 'encaissement' : 'décaissement'}</span></span> },
          { title: 'TVA', dataIndex: 'vatRate', width: 80, render: (r: number) => `${r.toLocaleString('fr-FR')} %` },
          {
            title: 'Compte comptable',
            width: 380,
            render: (_, c) => (
              <Select
                showSearch
                allowClear
                optionFilterProp="label"
                value={data.mappings[c.id]}
                placeholder={`Proposé : ${suggestAccount(c)}`}
                options={options}
                onChange={(v) => set(c.id, v ?? null)}
                style={{ width: 360 }}
              />
            ),
          },
        ]}
      />
    </div>
  );
}

function JournalsTab({ data, reload }: { data: PrecomptaData; reload: () => Promise<void> }) {
  const s = useStore();
  const save = useSaveSettings(reload);
  const j = data.settings.journals;
  const banks = data.chart.filter((a) => a.type === 'bank').map((a) => ({ value: a.number, label: `${a.number} · ${a.label}` }));
  return (
    <div className="config-pane">
      <div className="config-tools">
        <label className="field">
          Journal des ventes
          <Input defaultValue={j.sales} maxLength={10} style={{ width: 100 }} onBlur={(e) => e.target.value && e.target.value !== j.sales && save({ journals: { ...j, sales: e.target.value.toUpperCase() } })} />
        </label>
        <label className="field">
          Journal des achats
          <Input defaultValue={j.purchases} maxLength={10} style={{ width: 100 }} onBlur={(e) => e.target.value && e.target.value !== j.purchases && save({ journals: { ...j, purchases: e.target.value.toUpperCase() } })} />
        </label>
      </div>
      {s.accounts.length === 0 ? (
        <Empty description="Aucun compte bancaire." />
      ) : (
        <table className="mini-table vat-table">
          <thead>
            <tr>
              <th>Compte bancaire</th>
              <th>Journal</th>
              <th>Compte comptable</th>
            </tr>
          </thead>
          <tbody>
            {s.accounts.map((a) => (
              <tr key={a.id}>
                <th>{a.displayName || a.name}</th>
                <td>
                  <Input defaultValue={j.banks[a.id]} maxLength={10} style={{ width: 100 }} onBlur={(e) => e.target.value && e.target.value !== j.banks[a.id] && save({ journals: { ...j, banks: { ...j.banks, [a.id]: e.target.value.toUpperCase() } } })} />
                </td>
                <td>
                  <Select value={j.bankAccounts[a.id]} options={banks} style={{ width: 280 }} onChange={(v) => save({ journals: { ...j, bankAccounts: { ...j.bankAccounts, [a.id]: v } } })} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
