/** Trésorerie au jour le jour (écran 7.7) : creux à venir, simulation de report. */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Alert, App, Button, DatePicker, Popover, Segmented, Select, Switch, Table, Tabs, Tag, Tooltip as AntTooltip } from 'antd';
import { CloseOutlined, InfoCircleOutlined } from '@ant-design/icons';
import {
  Bar,
  Brush,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import dayjs from 'dayjs';
import {
  addDays,
  dailyKpis,
  dailyProjection,
  formatDate,
  formatEuro,
  formatEuroRounded,
  formatMonthShort,
  groupPoints,
  invoiceStatus,
  isOpen,
  remainingOf,
  STATUS_LABELS,
  type Bucket,
  type Granularity,
  type IsoDate,
} from '@optimum/treso-engine';
import { useStore } from '../../store/useStore';
import { useInvoiceAccounts, useProjection } from '../../store/projection';
import { accountLabel, canWrite } from '../../api/types';
import { MotifStrip } from '../../layout/Brand';
import './daily.css';

type Preset = 'month' | '30' | '60' | '90' | 'custom';
const ACCOUNT_COLORS = ['#114C5C', '#E94F1C', '#5B8C5A', '#8A6FB0', '#B8860B', '#303031'];

const k = (v: number) => `${Math.round(v / 1000)} k€`;

export function DailyPage() {
  const { message } = App.useApp();
  const today = useStore((s) => s.today);
  const accounts = useStore((s) => s.accounts);
  const categories = useStore((s) => s.categories);
  const transactions = useStore((s) => s.transactions);
  const threshold = useStore((s) => s.settings.minCashThreshold);
  const role = useStore((s) => s.role);
  const updateCommitment = useStore((s) => s.updateCommitment);
  const invoiceAccounts = useInvoiceAccounts();

  const [preset, setPreset] = useState<Preset>('60');
  const [custom, setCustom] = useState<[IsoDate, IsoDate]>([today, addDays(today, 60)]);
  const [granularity, setGranularity] = useState<Granularity>('day');
  const [accountIds, setAccountIds] = useState<string[] | null>(null);
  const [compare, setCompare] = useState(false);
  const [includeBudgets, setIncludeBudgets] = useState(false);
  const [shifts, setShifts] = useState<Map<string, IsoDate>>(new Map());
  const [hover, setHover] = useState<Bucket | null>(null);
  const [pinned, setPinned] = useState<Bucket | null>(null);
  const [saving, setSaving] = useState(false);

  const [from, to] = useMemo((): [IsoDate, IsoDate] => {
    if (preset === 'custom') return custom;
    if (preset === 'month') {
      const end = dayjs(today).endOf('month').format('YYYY-MM-DD');
      return [`${today.slice(0, 8)}01`, end];
    }
    // Quelques jours de passé pour voir d'où l'on part
    return [addDays(today, -7), addDays(today, Number(preset))];
  }, [preset, custom, today]);

  const { points, commitments, accountIds: ids } = useProjection({ from, to, accountIds, includeBudgets, shifts });
  const buckets = useMemo(() => groupPoints(points, granularity), [points, granularity]);
  const kpi = useMemo(() => dailyKpis(points), [points]);

  // Une courbe par compte (« Comparer des comptes »)
  const compareIds = useMemo(() => (compare ? ids : []), [compare, ids]);
  const perAccount = useProjectionsByAccount(compareIds, from, to, shifts);

  const label = (b: Bucket) => (granularity === 'month' ? formatMonthShort(b.start) : granularity === 'week' ? `sem. ${formatDate(b.start, false)}` : formatDate(b.start, false));
  const data = buckets.map((b, i) => {
    const row: Record<string, number | string> = {
      label: label(b),
      i,
      inActual: b.inActual,
      inPlanned: b.inPlanned,
      outActual: -b.outActual,
      outPlanned: -b.outPlanned,
      closing: b.closing,
    };
    perAccount.forEach((p) => (row[`acc_${p.id}`] = p.buckets(granularity)[i]?.closing ?? 0));
    return row;
  });
  const todayIndex = buckets.findIndex((b) => b.start <= today && b.end >= today);
  const focus = pinned ?? hover;

  const byId = useMemo(() => new Map(commitments.map((c) => [c.id, c])), [commitments]);
  const upcoming = useMemo(() => {
    const list = commitments
      .filter((c) => isOpen(c) && !c.hidden)
      .map((c) => {
        const due = shifts.get(c.id) ?? c.dueAt;
        return { c, due, counted: due < today ? today : due };
      })
      .filter((x) => x.counted >= from && x.counted <= to)
      .filter((x) => !focus || (x.counted >= focus.start && x.counted <= focus.end))
      .sort((a, b) => a.counted.localeCompare(b.counted));
    return list;
  }, [commitments, shifts, today, from, to, focus]);

  const txList = useMemo(() => {
    const set = new Set(ids);
    return transactions
      .filter((t) => !t.parentId && set.has(t.accountId) && t.bookedAt >= from && t.bookedAt <= to && (!focus || (t.bookedAt >= focus.start && t.bookedAt <= focus.end)))
      .sort((a, b) => b.bookedAt.localeCompare(a.bookedAt));
  }, [transactions, ids, from, to, focus]);

  const catName = (id: string | null) => categories.find((c) => c.id === id)?.name ?? 'À catégoriser';
  const accName = (id: string | null | undefined) => {
    const a = accounts.find((x) => x.id === id);
    return a ? accountLabel(a) : 'Par défaut';
  };

  const saveShifts = async () => {
    setSaving(true);
    try {
      for (const [id, due] of shifts) await updateCommitment(id, { dueAt: due, paymentTerms: 'custom' });
      message.success(`${shifts.size} échéance${shifts.size > 1 ? 's' : ''} enregistrée${shifts.size > 1 ? 's' : ''}`);
      setShifts(new Map());
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Enregistrement impossible.');
    } finally {
      setSaving(false);
    }
  };

  const mayEdit = canWrite(role);
  const low = kpi.low;

  return (
    <div className="daily">
      <div className="ops-toolbar">
        <Select
          mode="multiple"
          allowClear
          maxTagCount="responsive"
          placeholder="Tous les comptes actifs"
          value={accountIds ?? []}
          onChange={(v: string[]) => setAccountIds(v.length ? v : null)}
          options={accounts.map((a) => ({ value: a.id, label: accountLabel(a) }))}
          style={{ minWidth: 220, maxWidth: 360 }}
          aria-label="Comptes"
        />
        <Select<Preset>
          value={preset}
          onChange={setPreset}
          style={{ width: 160 }}
          aria-label="Période"
          options={[
            { value: 'month', label: 'Ce mois' },
            { value: '30', label: '30 jours' },
            { value: '60', label: '60 jours' },
            { value: '90', label: '90 jours' },
            { value: 'custom', label: 'Personnalisée' },
          ]}
        />
        {preset === 'custom' && (
          <DatePicker.RangePicker
            format="DD/MM/YYYY"
            allowClear={false}
            value={[dayjs(custom[0]), dayjs(custom[1])]}
            onChange={(v) => v?.[0] && v[1] && setCustom([v[0].format('YYYY-MM-DD'), v[1].format('YYYY-MM-DD')])}
            disabledDate={(d) => !!custom && Math.abs(d.diff(dayjs(custom[0]), 'day')) > 366}
          />
        )}
        <Segmented<Granularity>
          value={granularity}
          onChange={setGranularity}
          options={[
            { value: 'day', label: 'Jour' },
            { value: 'week', label: 'Semaine' },
            { value: 'month', label: 'Mois' },
          ]}
        />
        <label className="switch-label">
          <Switch size="small" checked={compare} onChange={setCompare} disabled={ids.length < 2} /> Comparer des comptes
        </label>
        <label className="switch-label">
          <Switch size="small" checked={includeBudgets} onChange={setIncludeBudgets} /> Inclure les budgets
          <AntTooltip title="Désactivé : seules les factures engagées sont projetées. Activé : les budgets non couverts par des factures sont répartis sur le mois.">
            <InfoCircleOutlined className="muted" />
          </AntTooltip>
        </label>
      </div>

      <div className="daily-kpis">
        <div className="card daily-kpi">
          <span className="eyebrow">Solde de début</span>
          <span className="kpi-value num">{formatEuroRounded(kpi.opening)}</span>
          <span className="muted">{formatDate(from)}</span>
        </div>
        <div className="card daily-kpi">
          <span className="eyebrow">Solde de fin</span>
          <span className="kpi-value num">{formatEuroRounded(kpi.closing)}</span>
          <span className="muted">{formatDate(to)}</span>
        </div>
        <div className="card daily-kpi">
          <span className="eyebrow">Variation</span>
          <span className={`kpi-value num${kpi.variation < 0 ? ' neg-text' : ' pos-text'}`}>
            {kpi.variation >= 0 ? '+' : '−'}
            {formatEuroRounded(Math.abs(kpi.variation))}
          </span>
          <span className="muted">{kpi.variationPct === null ? '—' : `${kpi.variationPct > 0 ? '+' : ''}${kpi.variationPct.toLocaleString('fr-FR')} %`}</span>
        </div>
        <div className={`card daily-kpi${low && low.value < threshold ? ' warn' : ''}`}>
          <span className="eyebrow">Point bas</span>
          <span className="kpi-value num">{low ? formatEuroRounded(low.value) : '—'}</span>
          <span className={low && low.value < threshold ? 'warn-text' : 'muted'}>
            {low ? `le ${formatDate(low.date)}` : ''}
            {low && low.value < threshold ? ` · sous le seuil de ${formatEuroRounded(threshold)}` : ''}
          </span>
        </div>
      </div>

      {shifts.size > 0 && (
        <Alert
          type="warning"
          showIcon
          message={`Simulation : ${shifts.size} échéance${shifts.size > 1 ? 's' : ''} décalée${shifts.size > 1 ? 's' : ''}. La courbe tient compte des nouvelles dates.`}
          action={
            <div className="sim-actions">
              <Button size="small" onClick={() => setShifts(new Map())}>
                Annuler la simulation
              </Button>
              {mayEdit && (
                <Button size="small" type="primary" loading={saving} onClick={saveShifts}>
                  Enregistrer la nouvelle échéance{shifts.size > 1 ? 's' : ''}
                </Button>
              )}
            </div>
          }
        />
      )}

      <section className="card daily-chart">
        <ResponsiveContainer width="100%" height={320}>
          <ComposedChart
            data={data}
            margin={{ top: 16, right: 12, bottom: 0, left: 0 }}
            stackOffset="sign"
            onMouseMove={(st: { activeTooltipIndex?: number }) => setHover(st?.activeTooltipIndex !== undefined ? (buckets[st.activeTooltipIndex] ?? null) : null)}
            onMouseLeave={() => setHover(null)}
            onClick={(st: { activeTooltipIndex?: number }) => {
              const b = st?.activeTooltipIndex !== undefined ? buckets[st.activeTooltipIndex] : undefined;
              if (b) setPinned((p) => (p?.start === b.start ? null : b));
            }}
          >
            {todayIndex >= 0 && <ReferenceArea x1={data[todayIndex]!.label as string} x2={data[data.length - 1]!.label as string} fill="var(--opt-petrol)" fillOpacity={0.04} />}
            <CartesianGrid vertical={false} stroke="var(--opt-border)" />
            <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: 'var(--opt-text-muted)', fontSize: 11 }} minTickGap={16} />
            <YAxis tickFormatter={k} tickLine={false} axisLine={false} width={56} tick={{ fill: 'var(--opt-text-muted)', fontSize: 11 }} />
            <Tooltip content={<DailyTooltip buckets={buckets} byId={byId} />} cursor={{ fill: 'var(--opt-petrol)', fillOpacity: 0.06 }} />
            <ReferenceLine y={0} stroke="var(--opt-border)" />
            <ReferenceLine
              y={threshold}
              stroke="var(--opt-warning)"
              strokeDasharray="5 4"
              label={{ value: `Seuil ${formatEuroRounded(threshold)}`, position: 'insideTopRight', fill: 'var(--opt-warning)', fontSize: 11, fontWeight: 700 }}
            />
            {todayIndex >= 0 && (
              <ReferenceLine x={data[todayIndex]!.label as string} stroke="var(--opt-orange)" label={{ value: 'Aujourd’hui', position: 'top', fill: 'var(--opt-orange-text)', fontSize: 11, fontWeight: 700 }} />
            )}
            <Bar dataKey="inActual" name="Entrées réalisées" stackId="flows" fill="var(--opt-in)" maxBarSize={18} />
            <Bar dataKey="inPlanned" name="Entrées prévues" stackId="flows" fill="var(--opt-in-soft)" maxBarSize={18} />
            <Bar dataKey="outActual" name="Sorties réalisées" stackId="flows" fill="var(--opt-out-flow)" maxBarSize={18} />
            <Bar dataKey="outPlanned" name="Sorties prévues" stackId="flows" fill="var(--opt-out-soft)" maxBarSize={18} />
            {perAccount.length === 0 ? (
              <Line type="stepAfter" dataKey="closing" name="Solde" stroke="var(--opt-petrol)" strokeWidth={2.5} dot={false} isAnimationActive={false} />
            ) : (
              perAccount.map((p, i) => (
                <Line key={p.id} type="stepAfter" dataKey={`acc_${p.id}`} name={`Solde · ${p.name}`} stroke={ACCOUNT_COLORS[i % ACCOUNT_COLORS.length]} strokeWidth={2} dot={false} isAnimationActive={false} />
              ))
            )}
            {data.length > 40 && <Brush dataKey="label" height={22} stroke="var(--opt-sage)" travellerWidth={8} />}
          </ComposedChart>
        </ResponsiveContainer>
        <div className="daily-legend">
          <span><i style={{ background: 'var(--opt-in)' }} /> Entrées réalisées</span>
          <span><i style={{ background: 'var(--opt-in-soft)' }} /> Entrées prévues</span>
          <span><i style={{ background: 'var(--opt-out-flow)' }} /> Sorties réalisées</span>
          <span><i style={{ background: 'var(--opt-out-soft)' }} /> Sorties prévues</span>
          {perAccount.length === 0 ? (
            <span><i className="line" style={{ borderColor: 'var(--opt-petrol)' }} /> Solde</span>
          ) : (
            perAccount.map((p, i) => (
              <span key={p.id}><i className="line" style={{ borderColor: ACCOUNT_COLORS[i % ACCOUNT_COLORS.length] }} /> {p.name}</span>
            ))
          )}
        </div>
      </section>

      <section className="card ops-card">
        <Tabs
          className="daily-tabs"
          tabBarExtraContent={
            focus ? (
              <Tag closable={!!pinned} onClose={() => setPinned(null)} icon={pinned ? undefined : <CloseOutlined style={{ display: 'none' }} />}>
                {focus.start === focus.end ? formatDate(focus.start) : `${formatDate(focus.start, false)} → ${formatDate(focus.end, false)}`}
              </Tag>
            ) : (
              <span className="muted daily-hint">Survolez ou cliquez une barre pour filtrer</span>
            )
          }
          items={[
            {
              key: 'invoices',
              label: `Factures à venir (${upcoming.length})`,
              children:
                upcoming.length === 0 ? (
                  <div className="daily-empty">
                    <MotifStrip height={40} />
                    <p className="muted">Aucune facture sur cette période. Ajoutez vos factures pour voir les creux à venir.</p>
                    <Link to="/factures/clients">Factures clients</Link>
                  </div>
                ) : (
                  <Table
                    size="small"
                    rowKey={(x) => x.c.id}
                    pagination={{ pageSize: 25, hideOnSinglePage: true }}
                    dataSource={upcoming}
                    rowClassName={(x) => (shifts.has(x.c.id) ? 'row-simulated' : '')}
                    columns={[
                      {
                        title: 'Échéance',
                        render: (_, x) => (
                          <span className="op-date">
                            {formatDate(x.counted)}
                            {shifts.has(x.c.id) && <Tag color="orange">simulée</Tag>}
                            {x.c.dueAt < today && !shifts.has(x.c.id) && <Tag color="red">en retard</Tag>}
                          </span>
                        ),
                      },
                      { title: 'Tiers', render: (_, x) => <strong>{x.c.counterparty}</strong> },
                      { title: 'Libellé', render: (_, x) => x.c.number ?? x.c.label },
                      { title: 'Statut', render: (_, x) => STATUS_LABELS[invoiceStatus(x.c, today).status] },
                      { title: 'Catégorie', render: (_, x) => catName(x.c.categoryId) },
                      { title: 'Compte', render: (_, x) => accName(invoiceAccounts.get(x.c.id)) },
                      {
                        title: 'Montant',
                        align: 'right',
                        render: (_, x) => (
                          <span className={`num${x.c.flow === 'in' ? ' positive' : ''}`}>
                            {x.c.flow === 'in' ? '+' : '−'}
                            {formatEuro(remainingOf(x.c))}
                          </span>
                        ),
                      },
                      {
                        title: '',
                        width: 110,
                        render: (_, x) => (
                          <Popover
                            trigger="click"
                            title="Simuler un report"
                            content={
                              <div className="shift-pop">
                                <div className="shift-quick">
                                  {[7, 15, 30].map((n) => (
                                    <Button key={n} size="small" onClick={() => setShifts((m) => new Map(m).set(x.c.id, addDays(x.due < today ? today : x.due, n)))}>
                                      +{n} j
                                    </Button>
                                  ))}
                                </div>
                                <DatePicker
                                  format="DD/MM/YYYY"
                                  value={dayjs(x.due)}
                                  allowClear={false}
                                  onChange={(d) => d && setShifts((m) => new Map(m).set(x.c.id, d.format('YYYY-MM-DD')))}
                                />
                                {shifts.has(x.c.id) && (
                                  <Button type="link" size="small" onClick={() => setShifts((m) => { const n = new Map(m); n.delete(x.c.id); return n; })}>
                                    Revenir à l’échéance d’origine
                                  </Button>
                                )}
                              </div>
                            }
                          >
                            <Button size="small">Décaler</Button>
                          </Popover>
                        ),
                      },
                    ]}
                  />
                ),
            },
            {
              key: 'ops',
              label: `Opérations (${txList.length})`,
              children: (
                <Table
                  size="small"
                  rowKey="id"
                  pagination={{ pageSize: 25, hideOnSinglePage: true }}
                  dataSource={txList}
                  columns={[
                    { title: 'Date', dataIndex: 'bookedAt', render: (d: string) => formatDate(d) },
                    { title: 'Libellé', render: (_, t) => t.counterparty ?? t.label },
                    { title: 'Catégorie', render: (_, t) => (t.isSplit ? 'Divisée' : catName(t.categoryId)) },
                    { title: 'Compte', render: (_, t) => accName(t.accountId) },
                    { title: 'Montant', align: 'right', render: (_, t) => <span className={`num${t.amount > 0 ? ' positive' : ''}`}>{formatEuro(t.amount)}</span> },
                  ]}
                />
              ),
            },
          ]}
        />
      </section>
    </div>
  );
}

/**
 * Une projection par compte, pour « Comparer des comptes » : opérations et
 * factures attendues sur ce compte (les budgets ne se répartissent pas par compte).
 */
function useProjectionsByAccount(ids: string[], from: IsoDate, to: IsoDate, shifts: Map<string, IsoDate>) {
  const accounts = useStore((s) => s.accounts);
  const transactions = useStore((s) => s.transactions);
  const commitments = useStore((s) => s.commitments);
  const today = useStore((s) => s.today);
  const invoiceAccounts = useInvoiceAccounts();
  return useMemo(
    () =>
      ids.map((id) => {
        const acc = accounts.find((a) => a.id === id);
        const points = dailyProjection({
          from,
          to,
          today,
          currentBalance: acc?.balance ?? 0,
          transactions: transactions.filter((t) => t.accountId === id),
          commitments: commitments.filter((c) => invoiceAccounts.get(c.id) === id),
          shifts,
        });
        return { id, name: acc ? accountLabel(acc) : id, buckets: (g: Granularity) => groupPoints(points, g) };
      }),
    [ids, accounts, transactions, commitments, today, invoiceAccounts, from, to, shifts],
  );
}

interface TooltipProps {
  active?: boolean;
  label?: string;
  payload?: { payload: { i: number } }[];
  buckets: Bucket[];
  byId: Map<string, { counterparty: string; number?: string; flow: 'in' | 'out'; amountInclTax: number; amountPaid?: number }>;
}

function DailyTooltip({ active, payload, buckets, byId }: TooltipProps) {
  if (!active || !payload?.length) return null;
  const b = buckets[payload[0]!.payload.i];
  if (!b) return null;
  const inv = b.invoiceIds.map((id) => byId.get(id)).filter(Boolean).slice(0, 5);
  return (
    <div className="daily-tip">
      <strong>{b.start === b.end ? formatDate(b.start) : `${formatDate(b.start, false)} → ${formatDate(b.end, false)}`}</strong>
      <dl>
        <dt>Solde de début</dt>
        <dd>{formatEuroRounded(b.opening)}</dd>
        <dt>Entrées réalisées / prévues</dt>
        <dd>
          {formatEuroRounded(b.inActual)} / {formatEuroRounded(b.inPlanned)}
        </dd>
        <dt>Sorties réalisées / prévues</dt>
        <dd>
          {formatEuroRounded(b.outActual)} / {formatEuroRounded(b.outPlanned)}
        </dd>
        <dt>Solde de fin</dt>
        <dd>
          <strong>{formatEuroRounded(b.closing)}</strong>
        </dd>
      </dl>
      {inv.length > 0 && (
        <ul>
          {inv.map((c, i) => (
            <li key={i}>
              {c!.counterparty}
              {c!.number ? ` · ${c!.number}` : ''} : {c!.flow === 'in' ? '+' : '−'}
              {formatEuroRounded(c!.amountInclTax - (c!.amountPaid ?? 0))}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
