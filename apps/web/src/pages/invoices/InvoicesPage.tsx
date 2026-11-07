/** Factures clients et fournisseurs (écran 7.8), même écran paramétré par sens. */
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Alert, App, Button, Dropdown, Empty, Input, Segmented, Select, Table, Tag, Tooltip, type MenuProps } from 'antd';
import {
  ClockCircleOutlined,
  DownOutlined,
  ExportOutlined,
  LinkOutlined,
  MoreOutlined,
  PlusOutlined,
  RetweetOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import {
  formatDate,
  formatEuro,
  formatEuroRounded,
  monthOf,
  STATUS_LABELS,
  type Commitment,
  type Flow,
  type SeriesScope,
} from '@optimum/treso-engine';
import { useStore } from '../../store/useStore';
import { canWrite } from '../../api/types';
import { CategorySelect } from '../../components/CategorySelect';
import { downloadText } from '../../components/spreadsheet';
import { askScope, confirmAsync, InvoiceDrawer } from './InvoiceDrawer';
import { PayModal, ReconcileModal, ReminderModal, ShiftModal } from './InvoiceDialogs';
import { InvoiceImportWizard } from './InvoiceImportWizard';
import { useInvoiceRows, type InvoiceRow } from './useInvoiceData';
import './invoices.css';

type View = 'all' | 'upcoming' | 'overdue' | 'paid' | 'suggestions' | 'duplicates';
const VIEW_PARAM: Record<string, View> = { tout: 'all', 'a-venir': 'upcoming', retard: 'overdue', payees: 'paid', suggestions: 'suggestions', doublons: 'duplicates' };

const EMPTY: Record<View, string> = {
  all: 'Aucune facture pour l’instant. Ajoutez-en une ou importez un fichier.',
  upcoming: 'Aucune facture à venir.',
  overdue: 'Aucune facture en retard. Bravo !',
  paid: 'Aucune facture payée pour l’instant.',
  suggestions: 'Aucun rapprochement à proposer.',
  duplicates: 'Aucun doublon possible.',
};

export function InvoicesPage({ flow }: { flow: Flow }) {
  const { message, modal } = App.useApp();
  const [params, setParams] = useSearchParams();
  const role = useStore((s) => s.role);
  const today = useStore((s) => s.today);
  const accounts = useStore((s) => s.accounts);
  const store = useStore();
  const mayEdit = canWrite(role);
  const { rows, duplicates } = useInvoiceRows(flow);
  const view: View = VIEW_PARAM[params.get('vue') ?? ''] ?? 'all';
  const setView = (v: View) => {
    const key = Object.keys(VIEW_PARAM).find((k) => VIEW_PARAM[k] === v)!;
    setParams(v === 'all' ? {} : { vue: key }, { replace: true });
  };
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [drawer, setDrawer] = useState<{ open: boolean; invoice: Commitment | null }>({ open: false, invoice: null });
  const [importOpen, setImportOpen] = useState(false);
  const [reconcile, setReconcile] = useState<Commitment | null>(null);
  const [pay, setPay] = useState<Commitment | null>(null);
  const [shift, setShift] = useState<Commitment | null>(null);
  const [remind, setRemind] = useState<Commitment | null>(null);
  useEffect(() => setSelected([]), [flow, view]);

  const label = flow === 'in' ? 'client' : 'fournisseur';
  const currentMonth = monthOf(today);

  const kpi = useMemo(() => {
    const sum = (list: InvoiceRow[], f: (r: InvoiceRow) => number) => list.reduce((s, r) => s + f(r), 0);
    const upcoming = rows.filter((r) => r.status === 'upcoming' || r.status === 'partial');
    const overdue = rows.filter((r) => r.status === 'overdue');
    const paid = rows.filter((r) => r.status === 'paid' && (r.c.paidAt ?? r.c.dueAt) >= currentMonth);
    return {
      upcoming: { n: upcoming.length, total: sum(upcoming, (r) => r.remaining) },
      overdue: { n: overdue.length, total: sum(overdue, (r) => r.remaining) },
      paid: { n: paid.length, total: sum(paid, (r) => r.c.amountInclTax) },
    };
  }, [rows, currentMonth]);

  const counts = useMemo(
    () => ({
      all: rows.filter((r) => r.status !== 'cancelled').length,
      upcoming: kpi.upcoming.n,
      overdue: kpi.overdue.n,
      paid: rows.filter((r) => r.status === 'paid').length,
      suggestions: rows.filter((r) => r.hasSuggestion).length,
      duplicates: duplicates.length,
    }),
    [rows, kpi, duplicates],
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows
      .filter((r) => {
        if (view === 'upcoming' && r.status !== 'upcoming' && r.status !== 'partial') return false;
        if (view === 'overdue' && r.status !== 'overdue') return false;
        if (view === 'paid' && r.status !== 'paid') return false;
        if (view === 'suggestions' && !r.hasSuggestion) return false;
        if (view === 'duplicates' && !r.isDuplicate) return false;
        if (view === 'all' && r.status === 'cancelled') return false;
        if (!q) return true;
        return `${r.c.counterparty} ${r.c.number ?? ''} ${r.c.label} ${r.c.amountInclTax}`.toLowerCase().includes(q);
      })
      .sort((a, b) => (view === 'paid' ? b.c.dueAt.localeCompare(a.c.dueAt) : a.c.dueAt.localeCompare(b.c.dueAt)));
  }, [rows, view, query]);

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      message.success(ok);
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Action impossible.');
    }
  };

  const rowMenu = (r: InvoiceRow): MenuProps => {
    const c = r.c;
    const open = r.status !== 'paid' && r.status !== 'cancelled';
    return {
      items: [
        { key: 'edit', label: 'Modifier' },
        open && { key: 'pay', label: 'Marquer comme payée' },
        open && { key: 'reconcile', label: 'Rapprocher d’un paiement' },
        r.status === 'paid' && (c.amountPaid ?? 0) > 0 && { key: 'reconcile', label: 'Voir les rapprochements' },
        r.status === 'paid' && { key: 'unpay', label: 'Marquer comme non payée' },
        open && { key: 'shift', label: 'Décaler l’échéance' },
        flow === 'in' && r.status === 'overdue' && { key: 'remind', label: 'Relancer le client' },
        { key: 'duplicate', label: 'Dupliquer' },
        { key: 'hide', label: c.hidden ? 'Inclure dans les totaux' : 'Exclure des totaux' },
        { type: 'divider' as const },
        { key: 'delete', label: 'Supprimer', danger: true, disabled: c.source === 'integration' },
      ].filter(Boolean) as MenuProps['items'],
      onClick: async ({ key, domEvent }) => {
        domEvent.stopPropagation();
        if (key === 'edit') setDrawer({ open: true, invoice: c });
        else if (key === 'pay') setPay(c);
        else if (key === 'reconcile') setReconcile(c);
        else if (key === 'unpay') await run(() => store.updateCommitment(c.id, { status: 'pending', amountPaid: 0, paidAt: null }), 'Facture rouverte');
        else if (key === 'shift') setShift(c);
        else if (key === 'remind') setRemind(c);
        else if (key === 'duplicate') await run(async () => setDrawer({ open: true, invoice: await store.duplicateCommitment(c.id) }), 'Facture dupliquée');
        else if (key === 'hide') await run(() => store.updateCommitment(c.id, { hidden: !c.hidden }), c.hidden ? 'Facture incluse dans les totaux' : 'Facture exclue des totaux');
        else if (key === 'delete') {
          let scope: SeriesScope = 'one';
          if (c.seriesId) {
            const s = await askScope(modal, 'Supprimer une échéance récurrente', 'Supprimer', true);
            if (!s) return;
            scope = s;
          } else if (!(await confirmAsync(modal, `Supprimer la facture ${c.number ?? c.counterparty} ?`))) return;
          await run(async () => {
            const n = await store.deleteCommitment(c.id, scope);
            if (n > 1) message.info(`${n} échéances supprimées`);
          }, 'Facture supprimée');
        }
      },
    };
  };

  const bulk = async (action: 'pay' | 'hide' | 'delete') => {
    const ids = [...selected];
    if (action === 'delete' && !(await confirmAsync(modal, `Supprimer ${ids.length} facture${ids.length > 1 ? 's' : ''} ?`))) return;
    await run(async () => {
      for (const id of ids) {
        if (action === 'pay') await store.updateCommitment(id, { status: 'paid' });
        else if (action === 'hide') await store.updateCommitment(id, { hidden: true });
        else await store.deleteCommitment(id);
      }
      setSelected([]);
    }, action === 'pay' ? 'Factures marquées payées' : action === 'hide' ? 'Factures exclues des totaux' : 'Factures supprimées');
  };

  const exportCsv = () => {
    const head = ['Échéance', 'Tiers', 'Numéro', 'Libellé', 'Statut', 'Catégorie', 'Compte', 'Montant TTC', 'Reste à payer'];
    const catName = (id: string | null) => store.categories.find((c) => c.id === id)?.name ?? '';
    const lines = visible.map((r) =>
      [formatDate(r.c.dueAt), r.c.counterparty, r.c.number ?? '', r.c.label, STATUS_LABELS[r.status], catName(r.c.categoryId), r.accountText, String(r.c.amountInclTax).replace('.', ','), String(r.remaining).replace('.', ',')]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(';'),
    );
    downloadText(`factures-${flow === 'in' ? 'clients' : 'fournisseurs'}.csv`, [head.join(';'), ...lines].join('\n'));
  };

  const addMenu: MenuProps = {
    items: [
      { key: 'new', label: 'Nouvelle facture' },
      { key: 'import', label: 'Importer un fichier (CSV, XLSX)' },
      { key: 'ocr', label: 'Déposer des factures (OCR) · bientôt', disabled: true },
      { key: 'integration', label: 'Connecter mon logiciel de facturation · bientôt', disabled: true },
    ],
    onClick: ({ key }) => {
      if (key === 'new') setDrawer({ open: true, invoice: null });
      if (key === 'import') setImportOpen(true);
    },
  };

  const statusTag = (r: InvoiceRow) => {
    if (r.status === 'overdue')
      return (
        <Tag color="red" className="status-tag">
          En retard · +{r.daysLate} j
        </Tag>
      );
    const colors = { upcoming: 'cyan', partial: 'gold', paid: 'green', cancelled: 'default' } as const;
    return (
      <Tag color={colors[r.status]} className="status-tag">
        {STATUS_LABELS[r.status]}
      </Tag>
    );
  };

  const hasDefaultAccount = accounts.some((a) => a.isDefaultForCommitments);

  return (
    <div className="invoices">
      <div className="invoice-kpis">
        {(
          [
            ['upcoming', 'À venir', kpi.upcoming],
            ['overdue', 'En retard', kpi.overdue],
            ['paid', 'Payées ce mois', kpi.paid],
          ] as const
        ).map(([v, title, k]) => (
          <button key={v} type="button" className={`card kpi-btn${view === v ? ' active' : ''}${v === 'overdue' && k.n ? ' danger' : ''}`} onClick={() => setView(view === v ? 'all' : v)}>
            <span className="eyebrow">{title}</span>
            <span className="kpi-value num">{formatEuroRounded(k.total)}</span>
            <span className="muted">
              {k.n} facture{k.n > 1 ? 's' : ''}
            </span>
          </button>
        ))}
      </div>

      <div className="ops-toolbar">
        <Segmented<View>
          value={view}
          onChange={setView}
          options={[
            { value: 'all', label: `Toutes · ${counts.all}` },
            { value: 'upcoming', label: `À venir · ${counts.upcoming}` },
            { value: 'overdue', label: `En retard · ${counts.overdue}` },
            { value: 'paid', label: `Payées · ${counts.paid}` },
            { value: 'suggestions', label: `Rapprochements · ${counts.suggestions}` },
            { value: 'duplicates', label: `Doublons · ${counts.duplicates}` },
          ]}
        />
        <Input prefix={<SearchOutlined />} placeholder="Tiers, numéro, montant" allowClear value={query} onChange={(e) => setQuery(e.target.value)} className="ops-search" />
        <div className="ops-toolbar-actions">
          <Button icon={<ExportOutlined />} onClick={exportCsv} disabled={!visible.length}>
            Exporter
          </Button>
          {mayEdit && (
            <Dropdown menu={addMenu} trigger={['click']}>
              <Button type="primary" icon={<PlusOutlined />}>
                Ajouter <DownOutlined />
              </Button>
            </Dropdown>
          )}
        </div>
      </div>

      {!hasDefaultAccount && accounts.length > 0 && mayEdit && (
        <Alert
          type="info"
          showIcon
          message="Choisissez le compte qui recevra vos factures par défaut."
          action={
            <Link to="/parametres?onglet=banques">
              <Button size="small">Choisir le compte</Button>
            </Link>
          }
        />
      )}

      {duplicates.length > 0 && (view === 'all' || view === 'duplicates') && mayEdit && (
        <div className="dup-list">
          {duplicates.slice(0, view === 'duplicates' ? 50 : 2).map((p) => (
            <section key={`${p.manual.id}-${p.imported.id}`} className="card dup-card">
              <div className="dup-title">
                <strong>Doublon possible · {p.manual.counterparty}</strong>
                <span className="muted">Une échéance saisie à la main ressemble à une facture importée.</span>
              </div>
              <div className="dup-compare">
                {[
                  ['Saisie manuelle', p.manual],
                  ['Importée', p.imported],
                ].map(([title, c]) => {
                  const x = c as Commitment;
                  return (
                    <div key={title as string} className="dup-side">
                      <span className="eyebrow">{title as string}</span>
                      <span>
                        {x.counterparty}
                        {x.number ? ` · ${x.number}` : ''}
                        {x.seriesId && <RetweetOutlined className="muted" title="Récurrente" />}
                      </span>
                      <span className="muted">Échéance {formatDate(x.dueAt)}</span>
                      <strong className="num">{formatEuro(x.amountInclTax)}</strong>
                    </div>
                  );
                })}
              </div>
              <div className="dup-actions">
                <Button onClick={() => run(() => store.resolveDuplicate(p.manual.id, p.imported.id, 'keep'), 'Les deux factures sont conservées')}>Garder les deux</Button>
                <Button type="primary" onClick={() => run(() => store.resolveDuplicate(p.manual.id, p.imported.id, 'replace'), 'Échéance remplacée par la facture importée')}>
                  Remplacer par la facture importée
                </Button>
              </div>
            </section>
          ))}
        </div>
      )}

      <section className="card ops-card">
        {visible.length === 0 ? (
          <Empty className="invoice-empty" description={query ? 'Aucune facture ne correspond à votre recherche.' : EMPTY[view]}>
            {view === 'all' && mayEdit && !query && (
              <Button type="primary" onClick={() => setDrawer({ open: true, invoice: null })}>
                Ajouter une facture {label}
              </Button>
            )}
          </Empty>
        ) : (
          <Table<InvoiceRow>
            rowKey={(r) => r.c.id}
            dataSource={visible}
            size="middle"
            pagination={{ pageSize: 50, hideOnSinglePage: true, showSizeChanger: false }}
            rowSelection={mayEdit ? { selectedRowKeys: selected, onChange: (k) => setSelected(k as string[]) } : undefined}
            rowClassName={(r) => `op-row${r.c.hidden ? ' is-hidden' : ''}`}
            onRow={(r) => ({ onClick: (e) => !(e.target as HTMLElement).closest('.ant-select, .ant-dropdown-trigger, button, .ant-checkbox-wrapper') && setDrawer({ open: true, invoice: r.c }) })}
            columns={[
              {
                title: 'Échéance',
                key: 'due',
                width: 120,
                render: (_, r) => (
                  <span className="op-date">
                    {r.status === 'overdue' && <ClockCircleOutlined className="text-danger" aria-label="En retard" />}
                    {formatDate(r.c.dueAt)}
                  </span>
                ),
              },
              { title: 'Tiers', key: 'cp', render: (_, r) => <strong>{r.c.counterparty}</strong> },
              {
                title: 'Libellé / numéro',
                key: 'label',
                render: (_, r) => (
                  <span className="op-label">
                    <span>
                      {r.c.number ?? r.c.label}
                      {r.c.seriesId && (
                        <Tooltip title={`Échéance récurrente${r.c.seriesIndex ? ` n° ${r.c.seriesIndex}` : ''}`}>
                          <RetweetOutlined className="series-icon" aria-label="Récurrente" />
                        </Tooltip>
                      )}
                      {r.hasSuggestion && (
                        <Tooltip title="Un paiement correspond peut-être à cette facture">
                          <LinkOutlined className="series-icon suggestion" aria-label="Rapprochement suggéré" />
                        </Tooltip>
                      )}
                      {r.c.source !== 'manual' && <Tag className="src-tag">{r.c.source === 'import' ? 'Importée' : r.c.source === 'ocr' ? 'OCR' : 'Synchronisée'}</Tag>}
                    </span>
                    <span className="muted op-raw">{r.accountText}</span>
                  </span>
                ),
              },
              { title: 'Statut', key: 'status', width: 170, render: (_, r) => statusTag(r) },
              {
                title: 'Catégorie',
                key: 'cat',
                width: 220,
                render: (_, r) => (
                  <CategorySelect
                    flow={flow}
                    value={r.c.categoryId}
                    quiet
                    size="small"
                    disabled={!mayEdit}
                    ariaLabel={`Catégorie de ${r.c.counterparty}`}
                    onChange={(id) => void run(() => store.updateCommitment(r.c.id, { categoryId: id ?? undefined }), 'Catégorie enregistrée')}
                    style={{ width: '100%' }}
                  />
                ),
              },
              { title: 'Montant TTC', key: 'amount', align: 'right', width: 130, render: (_, r) => <span className="num">{formatEuro(r.c.amountInclTax)}</span> },
              {
                title: 'Reste à payer',
                key: 'rest',
                align: 'right',
                width: 130,
                render: (_, r) => <span className={`num${r.status === 'overdue' ? ' text-danger' : ''}`}>{r.remaining > 0 ? formatEuro(r.remaining) : '—'}</span>,
              },
              ...(mayEdit
                ? [
                    {
                      title: '',
                      key: 'menu',
                      width: 48,
                      render: (_: unknown, r: InvoiceRow) => (
                        <Dropdown menu={rowMenu(r)} trigger={['click']}>
                          <Button type="text" size="small" icon={<MoreOutlined />} aria-label={`Actions sur ${r.c.number ?? r.c.counterparty}`} onClick={(e) => e.stopPropagation()} />
                        </Dropdown>
                      ),
                    },
                  ]
                : []),
            ]}
          />
        )}
      </section>

      {selected.length > 0 && (
        <div className="ops-bulk" role="toolbar" aria-label="Actions sur la sélection">
          <strong>
            {selected.length} sélectionnée{selected.length > 1 ? 's' : ''}
          </strong>
          <Button onClick={() => bulk('pay')}>Marquer payées</Button>
          <Button onClick={() => bulk('hide')}>Exclure des totaux</Button>
          <Button danger onClick={() => bulk('delete')}>
            Supprimer
          </Button>
          <Button type="text" onClick={() => setSelected([])}>
            Annuler
          </Button>
        </div>
      )}

      <InvoiceDrawer open={drawer.open} flow={flow} invoice={drawer.invoice} onClose={() => setDrawer({ open: false, invoice: null })} />
      <InvoiceImportWizard open={importOpen} flow={flow} onClose={() => setImportOpen(false)} />
      <ReconcileModal invoice={reconcile} onClose={() => setReconcile(null)} />
      <PayModal invoice={pay} onClose={() => setPay(null)} />
      <ShiftModal invoice={shift} onClose={() => setShift(null)} />
      <ReminderModal invoice={remind} onClose={() => setRemind(null)} />
    </div>
  );
}

