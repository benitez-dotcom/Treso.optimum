import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Alert, App, Button, DatePicker, Drawer, Dropdown, Empty, Form, Input, InputNumber, Modal, Popconfirm, Segmented, Select, Table, Tag, Tooltip } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  CalendarOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EyeInvisibleOutlined,
  EyeOutlined,
  MessageOutlined,
  PlusOutlined,
  ScissorOutlined,
  SearchOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import {
  formatDate,
  formatEuro,
  matchesSearch,
  proposeRuleFrom,
  type BankAccount,
  type Transaction,
} from '@optimum/treso-engine';
import { ApiError } from '../api/client';
import { accountLabel, canWrite } from '../api/types';
import { CategorySelect } from '../components/CategorySelect';
import { ImportWizard } from '../components/ImportWizard';
import { SplitModal } from '../components/SplitModal';
import { MotifStrip } from '../layout/Brand';
import { useStore } from '../store/useStore';
import './operations.css';

type State = 'all' | 'uncategorized' | 'suggested' | 'hidden' | 'split' | 'noted';
type Direction = 'all' | 'in' | 'out';

const stateLabels: Record<State, string> = {
  all: 'Toutes',
  uncategorized: 'À catégoriser',
  suggested: 'Suggérées',
  hidden: 'Exclues',
  split: 'Divisées',
  noted: 'Commentées',
};

const hiddenReasonLabel: Record<string, string> = {
  manual: 'Exclue des totaux',
  refund: 'Remboursement exclu automatiquement',
  internal_transfer: 'Virement entre vos comptes, exclu automatiquement',
};

const errMsg = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

/** Toast après catégorisation : similaires, création de règle, annulation (écran 7.6). */
function useCategorizeWithToast() {
  const { message } = App.useApp();
  const categorize = useStore((s) => s.categorize);
  const undo = useStore((s) => s.undo);
  const createRule = useStore((s) => s.createRule);
  const categories = useStore((s) => s.categories);
  return (ids: string[], categoryId: string, reference?: Transaction) => {
    const similar = categorize(ids, categoryId);
    const name = categories.find((c) => c.id === categoryId)?.name ?? '';
    const key = `cat-${ids[0]}`;
    const n = ids.length;
    message.open({
      key,
      type: 'success',
      duration: 8,
      content: (
        <span className="toast">
          {n > 1 ? `${n} opérations catégorisées` : 'Catégorisée'} en {name}
          {similar.length > 0 && (
            <>
              {' · '}
              {similar.length} similaire{similar.length > 1 ? 's' : ''}
              <button
                type="button"
                className="toast-action"
                onClick={() => {
                  categorize(similar.map((t) => t.id), categoryId);
                  message.open({ key, type: 'success', content: `${similar.length} opération${similar.length > 1 ? 's' : ''} similaire${similar.length > 1 ? 's' : ''} catégorisée${similar.length > 1 ? 's' : ''} en ${name}` });
                }}
              >
                Appliquer
              </button>
            </>
          )}
          {reference && (
            <button
              type="button"
              className="toast-action"
              onClick={async () => {
                try {
                  await createRule({ conditions: [proposeRuleFrom(reference)], categoryId, autoApply: true, priority: 5 });
                  message.open({ key, type: 'success', content: `Règle créée : « ${reference.counterparty ?? reference.label} » ira toujours en ${name}.` });
                } catch (e) {
                  message.error(errMsg(e, 'La règle n’a pas pu être créée.'));
                }
              }}
            >
              Créer une règle
            </button>
          )}
          <button type="button" className="toast-action" onClick={() => { undo(); message.destroy(key); }}>
            Annuler
          </button>
        </span>
      ),
    });
  };
}

function exportCsv(rows: Transaction[], accountName: (id: string) => string, categoryName: (id: string | null) => string) {
  const esc = (v: string) => (/[";\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = [
    ['Date', 'Date bancaire', 'Libellé', 'Libellé bancaire', 'Compte', 'Catégorie', 'Montant', 'Exclue', 'Note'].join(';'),
    ...rows.map((t) =>
      [
        formatDate(t.bookedAt),
        t.originalBookedAt ? formatDate(t.originalBookedAt) : '',
        t.label,
        t.rawLabel,
        accountName(t.accountId),
        t.isSplit ? 'Divisée' : categoryName(t.categoryId),
        t.amount.toFixed(2).replace('.', ','),
        t.hidden ? 'oui' : '',
        t.note ?? '',
      ]
        .map((v) => esc(String(v)))
        .join(';'),
    ),
  ];
  const url = URL.createObjectURL(new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: `operations-${new Date().toISOString().slice(0, 10)}.csv` });
  a.click();
  URL.revokeObjectURL(url);
}

/** Drawer de détail d'une opération. */
function OperationDrawer({ id, onClose, onSplit }: { id: string | null; onClose: () => void; onSplit: (t: Transaction) => void }) {
  const { message, modal } = App.useApp();
  const all = useStore((s) => s.transactions);
  const accounts = useStore((s) => s.accounts);
  const role = useStore((s) => s.role);
  const setHidden = useStore((s) => s.setHidden);
  const setNote = useStore((s) => s.setNote);
  const setBookedAt = useStore((s) => s.setBookedAt);
  const unsplit = useStore((s) => s.unsplitTransaction);
  const deleteTransactions = useStore((s) => s.deleteTransactions);
  const categorize = useCategorizeWithToast();
  const rawCategorize = useStore((s) => s.categorize);
  const clearCategory = (ids: string[]) => rawCategorize(ids, null as unknown as string);
  const t = all.find((x) => x.id === id) ?? null;
  const lines = useMemo(() => (t ? all.filter((x) => x.parentId === t.id) : []), [all, t]);
  const [note, setNoteDraft] = useState('');
  const [editDate, setEditDate] = useState(false);
  const writable = canWrite(role);

  useEffect(() => {
    setNoteDraft(t?.note ?? '');
    setEditDate(false);
  }, [t?.id, t?.note]);

  if (!t) return <Drawer open={false} onClose={onClose} />;
  const account = accounts.find((a) => a.id === t.accountId);
  const flow = t.amount < 0 ? 'out' : 'in';
  const deletable = t.source === 'manual' || t.source === 'import';

  return (
    <Drawer open={Boolean(id)} onClose={onClose} width={460} title="Détail de l'opération" destroyOnHidden>
      <div className="op-drawer">
        <div className="op-drawer-amount">
          <strong className={`num${t.amount > 0 ? ' positive' : ''}`}>{t.amount > 0 ? '+' : '−'}{formatEuro(Math.abs(t.amount))}</strong>
          {t.hidden && <Tag>{hiddenReasonLabel[t.hiddenReason ?? 'manual']}</Tag>}
        </div>
        <dl className="op-facts">
          <dt>Libellé</dt>
          <dd>
            <strong>{t.label}</strong>
            <span className="muted op-raw">{t.rawLabel}</span>
          </dd>
          {t.counterparty && (
            <>
              <dt>Tiers</dt>
              <dd>{t.counterparty}</dd>
            </>
          )}
          <dt>Date</dt>
          <dd>
            {editDate ? (
              <DatePicker
                autoFocus
                format="DD/MM/YYYY"
                defaultValue={dayjs(t.bookedAt)}
                allowClear={false}
                onChange={async (d: Dayjs | null) => {
                  if (!d) return;
                  try {
                    await setBookedAt(t.id, d.format('YYYY-MM-DD'));
                    message.success("Date d'imputation modifiée");
                    setEditDate(false);
                  } catch (e) {
                    message.error(errMsg(e, 'La date n’a pas pu être modifiée.'));
                  }
                }}
              />
            ) : (
              <span>
                {formatDate(t.bookedAt)}
                {t.originalBookedAt && <span className="muted"> · date bancaire {formatDate(t.originalBookedAt)}</span>}
              </span>
            )}
          </dd>
          <dt>Compte</dt>
          <dd>{account ? `${accountLabel(account)} · ${account.bankName}` : '—'}</dd>
          <dt>Origine</dt>
          <dd>{{ bank: 'Synchronisée avec la banque', manual: 'Saisie manuelle', import: 'Importée depuis un fichier', split: 'Ligne de division' }[t.source ?? 'bank']}</dd>
        </dl>

        {!t.isSplit && (
          <div className="op-field">
            <label>Catégorie</label>
            <CategorySelect
              flow={flow}
              value={t.categoryId}
              suggestionId={t.suggestion?.categoryId}
              disabled={!writable}
              ariaLabel="Catégorie de l'opération"
              style={{ width: '100%' }}
              onChange={(cid) => (cid ? categorize([t.id], cid, t) : clearCategory([t.id]))}
            />
            {t.suggestion && !t.categoryId && (
              <span className="muted">Suggestion ({t.suggestion.source === 'rule' ? 'règle' : t.suggestion.source === 'similar' ? 'opérations similaires' : 'IA'}) : choisissez-la pour la valider.</span>
            )}
          </div>
        )}

        {t.isSplit && (
          <div className="op-field">
            <label>Lignes de la division</label>
            <ul className="op-lines">
              {lines.map((l) => (
                <li key={l.id}>
                  <CategorySelect flow={flow} value={l.categoryId} disabled={!writable} ariaLabel="Catégorie de la ligne" size="small" style={{ flex: 1 }} onChange={(cid) => cid && categorize([l.id], cid)} />
                  <span className="num">{formatEuro(l.amount)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="op-field">
          <label htmlFor="op-note">Note</label>
          <Input.TextArea
            id="op-note"
            rows={2}
            maxLength={500}
            disabled={!writable}
            value={note}
            placeholder="Ajouter une note (visible par toute l'équipe)"
            onChange={(e) => setNoteDraft(e.target.value)}
            onBlur={() => note !== (t.note ?? '') && setNote(t.id, note.trim() || null)}
          />
        </div>

        {writable && (
          <div className="op-actions">
            {!t.parentId && (
              <Button icon={<CalendarOutlined />} onClick={() => setEditDate(true)}>
                Changer la date d'imputation
              </Button>
            )}
            {t.originalBookedAt && !t.parentId && (
              <Button onClick={() => setBookedAt(t.id, null).then(() => message.success('Date bancaire rétablie'))}>Revenir à la date bancaire</Button>
            )}
            {!t.parentId &&
              (t.isSplit ? (
                <>
                  <Button icon={<ScissorOutlined />} onClick={() => onSplit(t)}>Modifier la division</Button>
                  <Popconfirm title="Annuler la division ?" description="L'opération reprend la catégorie de sa plus grande ligne." okText="Annuler la division" cancelText="Garder" onConfirm={() => unsplit(t.id).then(() => message.success('Division annulée'))}>
                    <Button>Annuler la division</Button>
                  </Popconfirm>
                </>
              ) : (
                <Button icon={<ScissorOutlined />} onClick={() => onSplit(t)}>Diviser</Button>
              ))}
            {!t.parentId && (
              <Button icon={t.hidden ? <EyeOutlined /> : <EyeInvisibleOutlined />} onClick={() => setHidden([t.id], !t.hidden)}>
                {t.hidden ? 'Réintégrer dans les totaux' : 'Exclure des totaux'}
              </Button>
            )}
            {deletable && (
              <Button
                danger
                icon={<DeleteOutlined />}
                onClick={() =>
                  modal.confirm({
                    title: 'Supprimer cette opération ?',
                    content: 'Cette action est définitive.',
                    okText: 'Supprimer',
                    okButtonProps: { danger: true },
                    cancelText: 'Annuler',
                    onOk: async () => {
                      await deleteTransactions([t.id]);
                      message.success('Opération supprimée');
                      onClose();
                    },
                  })
                }
              >
                Supprimer
              </Button>
            )}
          </div>
        )}
      </div>
    </Drawer>
  );
}

/** Saisie d'une opération sur un compte manuel. */
function NewOperationModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { message } = App.useApp();
  const allAccounts = useStore((s) => s.accounts);
  const accounts = useMemo(() => allAccounts.filter((a) => a.isManual), [allAccounts]);
  if (accounts.length === 0) {
    return (
      <Modal open={open} onCancel={onClose} title="Nouvelle opération" footer={<Button onClick={onClose}>Fermer</Button>}>
        <p>Les opérations de vos banques connectées arrivent automatiquement. Pour saisir une opération à la main (caisse, banque non couverte), créez d'abord un compte manuel.</p>
        <Link to="/parametres?onglet=banques" onClick={onClose}>
          <Button type="primary">Créer un compte manuel</Button>
        </Link>
      </Modal>
    );
  }
  return <NewOperationForm open={open} onClose={onClose} accounts={accounts} />;
}

function NewOperationForm({ open, onClose, accounts }: { open: boolean; onClose: () => void; accounts: BankAccount[] }) {
  const { message } = App.useApp();
  const create = useStore((s) => s.createTransaction);
  const [form] = Form.useForm();
  const [direction, setDirection] = useState<'out' | 'in'>('out');
  const [saving, setSaving] = useState(false);
  return (
    <Modal
      open={open}
      onCancel={onClose}
      title="Nouvelle opération"
      okText="Enregistrer"
      cancelText="Annuler"
      confirmLoading={saving}
      destroyOnHidden
      onOk={async () => {
        const v = await form.validateFields();
        setSaving(true);
        try {
          await create({
            accountId: v.accountId,
            bookedAt: (v.bookedAt as Dayjs).format('YYYY-MM-DD'),
            label: v.label,
            amount: direction === 'out' ? -Math.abs(v.amount) : Math.abs(v.amount),
            categoryId: v.categoryId ?? null,
            note: v.note || undefined,
          });
          message.success('Opération enregistrée');
          form.resetFields();
          onClose();
        } catch (e) {
          message.error(errMsg(e, "L'opération n'a pas pu être enregistrée."));
        } finally {
          setSaving(false);
        }
      }}
    >
      <Form form={form} layout="vertical" requiredMark={false} initialValues={{ accountId: accounts[0]!.id, bookedAt: dayjs() }}>
        <Segmented value={direction} onChange={(v) => { setDirection(v as 'in' | 'out'); form.setFieldValue('categoryId', undefined); }} options={[{ value: 'out', label: 'Décaissement' }, { value: 'in', label: 'Encaissement' }]} style={{ marginBottom: 16 }} />
        <div className="inline-row">
          <Form.Item name="bookedAt" label="Date" rules={[{ required: true, message: 'Indiquez la date.' }]}>
            <DatePicker format="DD/MM/YYYY" style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="amount" label="Montant" rules={[{ required: true, message: 'Indiquez le montant.' }, { type: 'number', min: 0.01, message: 'Le montant doit être positif.' }]}>
            <InputNumber<number> min={0} precision={2} decimalSeparator="," addonAfter="€" style={{ width: '100%' }} />
          </Form.Item>
        </div>
        <Form.Item name="label" label="Libellé" rules={[{ required: true, whitespace: true, message: 'Indiquez un libellé.' }]}>
          <Input maxLength={200} placeholder="Ex. : Achat fournitures" />
        </Form.Item>
        <Form.Item name="accountId" label="Compte">
          <Select options={accounts.map((a) => ({ value: a.id, label: accountLabel(a) }))} />
        </Form.Item>
        <Form.Item name="categoryId" label="Catégorie">
          <CategorySelect flow={direction} value={form.getFieldValue('categoryId')} onChange={(id) => form.setFieldValue('categoryId', id)} ariaLabel="Catégorie" style={{ width: '100%' }} placeholder="Choisir une catégorie" />
        </Form.Item>
        <Form.Item name="note" label="Note">
          <Input.TextArea rows={2} maxLength={500} />
        </Form.Item>
      </Form>
    </Modal>
  );
}

export function OperationsPage() {
  const { message, modal } = App.useApp();
  const transactions = useStore((s) => s.transactions);
  const accounts = useStore((s) => s.accounts);
  const categories = useStore((s) => s.categories);
  const role = useStore((s) => s.role);
  const setHidden = useStore((s) => s.setHidden);
  const acceptSuggestions = useStore((s) => s.acceptSuggestions);
  const deleteTransactions = useStore((s) => s.deleteTransactions);
  const categorize = useCategorizeWithToast();
  const writable = canWrite(role);
  const [params, setParams] = useSearchParams();

  const [query, setQuery] = useState('');
  const [accountIds, setAccountIds] = useState<string[]>([]);
  const [range, setRange] = useState<[Dayjs | null, Dayjs | null] | null>(null);
  const [direction, setDirection] = useState<Direction>('all');
  const [state, setState] = useState<State>((params.get('etat') as State) ?? 'all');
  const [categoryFilter, setCategoryFilter] = useState<string[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [openId, setOpenId] = useState<string | null>(params.get('operation'));
  const [splitting, setSplitting] = useState<Transaction | null>(null);
  const [importing, setImporting] = useState(false);
  const [creating, setCreating] = useState(false);
  const [bulkCategory, setBulkCategory] = useState<string | null>(null);

  const accountName = (id: string) => {
    const a = accounts.find((x) => x.id === id);
    return a ? accountLabel(a) : '—';
  };
  const categoryName = (id: string | null) => (id ? (categories.find((c) => c.id === id)?.name ?? '') : '');

  // Une ligne par opération bancaire ; les lignes de division s'affichent dans le détail
  const base = useMemo(() => transactions.filter((t) => !t.parentId), [transactions]);
  /** Catégories des lignes de chaque opération divisée (« __none » = ligne à catégoriser). */
  const childCategories = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const t of transactions) if (t.parentId) m.set(t.parentId, [...(m.get(t.parentId) ?? []), t.categoryId ?? '__none']);
    return m;
  }, [transactions]);

  const counts = useMemo(() => {
    const c: Record<State, number> = { all: base.length, uncategorized: 0, suggested: 0, hidden: 0, split: 0, noted: 0 };
    for (const t of base) {
      if (!t.categoryId && !t.isSplit && !t.hidden) c.uncategorized++;
      if (t.suggestion && !t.categoryId && !t.hidden) c.suggested++;
      if (t.hidden) c.hidden++;
      if (t.isSplit) c.split++;
      if (t.note) c.noted++;
    }
    return c;
  }, [base]);

  const rows = useMemo(() => {
    const from = range?.[0]?.format('YYYY-MM-DD');
    const to = range?.[1]?.format('YYYY-MM-DD');
    const catSet = new Set(categoryFilter);
    return base
      .filter((t) => {
        if (accountIds.length && !accountIds.includes(t.accountId)) return false;
        if (from && t.bookedAt < from) return false;
        if (to && t.bookedAt > to) return false;
        if (direction === 'in' && t.amount < 0) return false;
        if (direction === 'out' && t.amount > 0) return false;
        if (state === 'uncategorized' && (t.categoryId || t.isSplit || t.hidden)) return false;
        if (state === 'suggested' && !(t.suggestion && !t.categoryId && !t.hidden)) return false;
        if (state === 'hidden' && !t.hidden) return false;
        if (state === 'split' && !t.isSplit) return false;
        if (state === 'noted' && !t.note) return false;
        if (catSet.size) {
          const ids = t.isSplit ? (childCategories.get(t.id) ?? []) : [t.categoryId ?? '__none'];
          if (!ids.some((id) => catSet.has(id))) return false;
        }
        return matchesSearch(t, query);
      })
      .sort((a, b) => b.bookedAt.localeCompare(a.bookedAt) || a.id.localeCompare(b.id));
  }, [base, accountIds, range, direction, state, categoryFilter, query, childCategories]);

  const total = rows.reduce((s, t) => s + (t.hidden ? 0 : t.amount), 0);
  const selectedTx = base.filter((t) => selected.includes(t.id));
  const mixed = selectedTx.some((t) => t.amount > 0) && selectedTx.some((t) => t.amount < 0);

  useEffect(() => {
    // Les filtres de l'URL (lien depuis l'accueil ou « À traiter ») restent synchronisés
    const next = new URLSearchParams(params);
    if (state === 'all') next.delete('etat');
    else next.set('etat', state);
    if (openId) next.set('operation', openId);
    else next.delete('operation');
    if (next.toString() !== params.toString()) setParams(next, { replace: true });
  }, [state, openId, params, setParams]);

  if (accounts.length === 0) {
    return (
      <section className="card ops-empty">
        <MotifStrip height={64} />
        <div>
          <h2>Connectez votre banque pour voir vos opérations arriver automatiquement.</h2>
          <p className="muted">Accès en lecture seule, agréé par l'ACPR. Vous pouvez aussi créer un compte manuel ou importer un relevé.</p>
          <Link to="/parametres?onglet=banques">
            <Button type="primary">Connecter une banque</Button>
          </Link>
        </div>
      </section>
    );
  }

  const columns: ColumnsType<Transaction> = [
    {
      title: 'Date',
      dataIndex: 'bookedAt',
      width: 120,
      render: (d: string, t) => (
        <span className="op-date">
          {formatDate(d)}
          {t.originalBookedAt && (
            <Tooltip title={`Date bancaire : ${formatDate(t.originalBookedAt)}`}>
              <CalendarOutlined className="op-icon" aria-label="Date d'imputation modifiée" />
            </Tooltip>
          )}
        </span>
      ),
    },
    {
      title: 'Libellé',
      dataIndex: 'label',
      render: (_: string, t) => (
        <span className="op-label">
          <strong>{t.label}</strong>
          <span className="muted op-raw">{t.rawLabel}</span>
        </span>
      ),
    },
    {
      title: 'Catégorie',
      width: 240,
      render: (_: unknown, t) =>
        t.isSplit ? (
          <span className="badge">
            Divisée · {childCategories.get(t.id)?.length ?? 0} lignes
            {childCategories.get(t.id)?.includes('__none') ? ' · à compléter' : ''}
          </span>
        ) : (
          <CategorySelect
            flow={t.amount < 0 ? 'out' : 'in'}
            value={t.categoryId}
            suggestionId={t.suggestion?.categoryId}
            disabled={!writable}
            quiet={t.hidden}
            size="small"
            ariaLabel={`Catégorie de ${t.label}`}
            style={{ width: '100%' }}
            onChange={(cid) => cid && categorize([t.id], cid, t)}
          />
        ),
    },
    { title: 'Compte', dataIndex: 'accountId', width: 170, responsive: ['lg'], render: (id: string) => <span className="muted">{accountName(id)}</span> },
    {
      title: 'Montant',
      dataIndex: 'amount',
      width: 130,
      align: 'right',
      sorter: (a, b) => a.amount - b.amount,
      render: (n: number, t) => (
        <span className={`num${n > 0 ? ' positive' : ''}${t.hidden ? ' is-hidden' : ''}`}>
          {n > 0 ? '+' : '−'}
          {formatEuro(Math.abs(n))}
        </span>
      ),
    },
    {
      title: <span className="visually-hidden">État</span>,
      width: 70,
      render: (_: unknown, t) => (
        <span className="op-state">
          {t.hidden && (
            <Tooltip title={hiddenReasonLabel[t.hiddenReason ?? 'manual']}>
              <EyeInvisibleOutlined aria-label="Exclue des totaux" />
            </Tooltip>
          )}
          {t.isSplit && (
            <Tooltip title="Divisée">
              <ScissorOutlined aria-label="Divisée" />
            </Tooltip>
          )}
          {t.note && (
            <Tooltip title={t.note}>
              <MessageOutlined aria-label="Commentée" />
            </Tooltip>
          )}
        </span>
      ),
    },
  ];

  return (
    <div className="ops">
      <div className="ops-toolbar">
        <Input
          allowClear
          prefix={<SearchOutlined aria-hidden="true" />}
          placeholder="Rechercher : libellé, tiers, montant (« ~120 »)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="ops-search"
          aria-label="Rechercher une opération"
        />
        <Select
          mode="multiple"
          allowClear
          maxTagCount="responsive"
          placeholder="Tous les comptes"
          value={accountIds}
          onChange={setAccountIds}
          options={accounts.map((a) => ({ value: a.id, label: accountLabel(a) }))}
          style={{ minWidth: 200 }}
          aria-label="Comptes"
        />
        <DatePicker.RangePicker format="DD/MM/YYYY" value={range} onChange={(v) => setRange(v as [Dayjs | null, Dayjs | null] | null)} placeholder={['Du', 'Au']} aria-label="Période" />
        <div className="ops-toolbar-actions">
          {writable && (
            <>
              <Button icon={<UploadOutlined />} onClick={() => setImporting(true)}>
                Importer un fichier
              </Button>
              <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>
                Nouvelle opération
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="ops-filters">
        <Segmented<State>
          value={state}
          onChange={(v) => { setState(v); setSelected([]); }}
          options={(Object.keys(stateLabels) as State[]).map((k) => ({ value: k, label: `${stateLabels[k]}${k === 'all' ? '' : ` · ${counts[k]}`}` }))}
        />
        <Segmented<Direction>
          value={direction}
          onChange={setDirection}
          options={[
            { value: 'all', label: 'Tous sens' },
            { value: 'in', label: 'Encaissements' },
            { value: 'out', label: 'Décaissements' },
          ]}
        />
        <Select
          mode="multiple"
          allowClear
          maxTagCount="responsive"
          placeholder="Catégories"
          value={categoryFilter}
          onChange={setCategoryFilter}
          options={[{ value: '__none', label: 'À catégoriser' }, ...categories.map((c) => ({ value: c.id, label: c.name }))]}
          optionFilterProp="label"
          style={{ minWidth: 180 }}
          aria-label="Filtrer par catégorie"
        />
      </div>

      <section className="card ops-card">
        <div className="ops-summary">
          <span>
            {rows.length} opération{rows.length > 1 ? 's' : ''}
          </span>
          <span className="muted">
            Solde des opérations affichées (hors exclues) : <strong className={`num${total > 0 ? ' positive' : ''}`}>{total > 0 ? '+' : ''}{formatEuro(total)}</strong>
          </span>
        </div>
        <Table<Transaction>
          rowKey="id"
          size="middle"
          dataSource={rows}
          columns={columns}
          pagination={{ pageSize: 50, showSizeChanger: true, pageSizeOptions: [25, 50, 100, 200], showTotal: (n) => `${n} opérations` }}
          rowSelection={writable ? { selectedRowKeys: selected, onChange: (k) => setSelected(k as string[]) } : undefined}
          rowClassName={(t) => `op-row${t.hidden ? ' is-hidden' : ''}`}
          onRow={(t) => ({
            onClick: (e) => {
              if ((e.target as HTMLElement).closest('.ant-select, .ant-checkbox-wrapper, button, input')) return;
              setOpenId(t.id);
            },
            onKeyDown: (e) => {
              if (e.key === 'Enter' && e.target === e.currentTarget) setOpenId(t.id);
            },
            tabIndex: 0,
            'aria-label': `${t.label}, ${formatEuro(t.amount)}, ${formatDate(t.bookedAt)}`,
          })}
          locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={query ? 'Aucune opération ne correspond à votre recherche.' : 'Aucune opération pour ces filtres.'} /> }}
          scroll={{ x: 760 }}
        />
      </section>

      {selected.length > 0 && (
        <div className="ops-bulk" role="toolbar" aria-label="Actions sur la sélection">
          <strong>
            {selected.length} sélectionnée{selected.length > 1 ? 's' : ''}
          </strong>
          {mixed && <span className="ops-bulk-warn">Votre sélection contient des encaissements et des décaissements.</span>}
          <CategorySelect
            flow={selectedTx.every((t) => t.amount > 0) ? 'in' : 'out'}
            value={bulkCategory}
            onChange={setBulkCategory}
            size="small"
            ariaLabel="Catégorie pour la sélection"
            placeholder="Catégoriser en…"
          />
          <Button
            size="small"
            type="primary"
            disabled={!bulkCategory}
            onClick={() => {
              categorize(selected, bulkCategory!, selectedTx.length === 1 ? selectedTx[0] : undefined);
              setSelected([]);
              setBulkCategory(null);
            }}
          >
            Catégoriser
          </Button>
          {selectedTx.some((t) => t.suggestion && !t.categoryId) && (
            <Button size="small" onClick={() => { acceptSuggestions(selected); message.success('Suggestions validées'); setSelected([]); }}>
              Valider les suggestions
            </Button>
          )}
          <Dropdown
            menu={{
              items: [
                { key: 'hide', label: 'Exclure des totaux', icon: <EyeInvisibleOutlined /> },
                { key: 'show', label: 'Réintégrer dans les totaux', icon: <EyeOutlined /> },
                { key: 'export', label: 'Exporter (CSV)', icon: <DownloadOutlined /> },
                { type: 'divider' },
                { key: 'delete', label: 'Supprimer', danger: true, icon: <DeleteOutlined /> },
              ],
              onClick: ({ key }) => {
                if (key === 'hide' || key === 'show') {
                  setHidden(selected, key === 'hide');
                  message.success(key === 'hide' ? 'Exclues des totaux' : 'Réintégrées dans les totaux');
                  setSelected([]);
                }
                if (key === 'export') exportCsv(selectedTx, accountName, categoryName);
                if (key === 'delete') {
                  const n = selected.length;
                  modal.confirm({
                    title: `Supprimer ${n} opération${n > 1 ? 's' : ''} ?`,
                    content: 'Cette action est définitive. Seules les opérations saisies à la main ou importées peuvent être supprimées.',
                    okText: 'Supprimer',
                    okButtonProps: { danger: true },
                    cancelText: 'Annuler',
                    onOk: async () => {
                      try {
                        const d = await deleteTransactions(selected);
                        message.success(`${d} opération${d > 1 ? 's' : ''} supprimée${d > 1 ? 's' : ''}`);
                        setSelected([]);
                      } catch (e) {
                        message.error(errMsg(e, 'La suppression a échoué.'));
                      }
                    },
                  });
                }
              },
            }}
          >
            <Button size="small">Plus d'actions</Button>
          </Dropdown>
          <Button size="small" type="text" onClick={() => setSelected([])}>
            Tout désélectionner
          </Button>
        </div>
      )}

      {!writable && <Alert type="info" showIcon message="Votre rôle permet de consulter les opérations, pas de les modifier." />}

      <OperationDrawer id={openId} onClose={() => setOpenId(null)} onSplit={(t) => setSplitting(t)} />
      {splitting && <SplitModal transaction={splitting} open onClose={() => setSplitting(null)} />}
      <ImportWizard open={importing} onClose={() => setImporting(false)} />
      <NewOperationModal open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}
