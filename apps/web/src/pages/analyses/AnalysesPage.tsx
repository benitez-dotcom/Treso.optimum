/**
 * Analyses (écran 7.12) : KPI 5.9 et comparaison à la période précédente,
 * où va l'argent, évolution par catégorie, prévu vs réalisé, tiers.
 * « Télécharger le rapport PDF » ouvre l'impression d'une mise en page dédiée.
 */
import { useMemo, useState } from 'react';
import { Button, DatePicker, Empty, Popover, Select, Switch, Table, Tooltip as AntTooltip } from 'antd';
import { CaretDownOutlined, CaretRightOutlined, ExportOutlined, FilePdfOutlined, QuestionCircleOutlined } from '@ant-design/icons';
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import dayjs from 'dayjs';
import {
  addMonths,
  analysisKpis,
  breakdownByCategory,
  budgetVsActual,
  displayValue,
  formatEuro,
  formatEuroRounded,
  formatMonthShort,
  last12Months,
  monthDiff,
  monthOf,
  periodMonthKeys,
  previousPeriod,
  topCounterparties,
  type AnalysisKpis,
  type BreakdownRow,
  type Flow,
  type Period2,
} from '@optimum/treso-engine';
import { useStore } from '../../store/useStore';
import { useCurrentBalance, usePlan } from '../../store/selectors';
import { ExportDrawer } from '../../exports/ExportDrawer';
import { Logo, MotifStrip } from '../../layout/Brand';
import './analyses.css';

const SERIES = [1, 2, 3, 4, 5, 6].map((i) => `var(--opt-series-${i})`);
const pctFmt = (v: number) => `${v.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %`;

interface KpiDef {
  key: keyof AnalysisKpis;
  label: string;
  format: (v: number, k: AnalysisKpis) => string;
  /** Une hausse est-elle une bonne nouvelle ? */
  higherIsBetter: boolean;
  help: string;
  config?: string;
}

const delayText = (v: number) => (v === 0 ? 'À l’heure' : v > 0 ? `${v} jour${v > 1 ? 's' : ''} de retard` : `${-v} jour${v < -1 ? 's' : ''} d’avance`);

const KPIS: KpiDef[] = [
  { key: 'autonomyMonths', label: 'Autonomie de trésorerie', format: (v) => `${v.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} mois`, higherIsBetter: true, help: 'Nombre de mois que votre solde actuel peut couvrir, au rythme moyen des décaissements des 3 derniers mois.' },
  { key: 'averageBalance', label: 'Solde moyen', format: (v) => formatEuroRounded(v), higherIsBetter: true, help: 'Moyenne des soldes de fin de journée sur la période.' },
  { key: 'daysBelowThreshold', label: 'Jours sous le seuil', format: (v) => `${v} jour${v > 1 ? 's' : ''}`, higherIsBetter: false, help: 'Nombre de jours où le solde a été inférieur à votre seuil de trésorerie minimum (Paramètres › Société).' },
  { key: 'daysBelowZero', label: 'Jours sous zéro', format: (v) => `${v} jour${v > 1 ? 's' : ''}`, higherIsBetter: false, help: 'Nombre de jours où le solde a été négatif.' },
  { key: 'purchasesOnRevenue', label: 'Achats / CA', format: pctFmt, higherIsBetter: false, help: 'Achats réglés ÷ ventes encaissées sur la période.', config: 'Indiquez la nature « Ventes » et « Achats » de vos catégories.' },
  { key: 'payrollOnRevenue', label: 'Masse salariale / CA', format: pctFmt, higherIsBetter: false, help: 'Salaires et charges sociales ÷ ventes encaissées.', config: 'Indiquez la nature « Masse salariale » de vos catégories de personnel.' },
  { key: 'overheadsOnRevenue', label: 'Frais généraux / CA', format: pctFmt, higherIsBetter: false, help: 'Frais de fonctionnement (loyer, logiciels, assurances…) ÷ ventes encaissées.', config: 'Indiquez la nature « Frais généraux » de vos catégories.' },
  { key: 'variableChargesShare', label: 'Charges variables / fixes', format: (v) => `Variables ${pctFmt(v)} · Fixes ${pctFmt(100 - v)}`, higherIsBetter: false, help: 'Part des achats dans l’ensemble des décaissements : le reste est considéré comme fixe.', config: 'Indiquez la nature « Achats » de vos catégories.' },
  { key: 'customerDelay', label: 'Délai d’encaissement clients', format: delayText, higherIsBetter: false, help: 'Écart moyen entre l’échéance et le paiement des factures clients payées sur la période, et retard des factures échues non payées.', config: 'Saisissez ou importez vos factures clients.' },
  { key: 'supplierDelay', label: 'Délai de paiement fournisseurs', format: delayText, higherIsBetter: true, help: 'Même calcul sur les factures fournisseurs : un retard préserve votre trésorerie, mais attention à la relation fournisseur.', config: 'Saisissez ou importez vos factures fournisseurs.' },
];

export function AnalysesPage() {
  const s = useStore();
  const balance = useCurrentBalance();
  const current = monthOf(s.today);
  const [range, setRange] = useState<Period2>(() => last12Months(s.today));
  const [compare, setCompare] = useState(true);
  const [exportOpen, setExportOpen] = useState(false);
  const prev = useMemo(() => previousPeriod(range), [range]);

  const input = { categories: s.categories, transactions: s.transactions, commitments: s.commitments, balance, today: s.today, threshold: s.settings.minCashThreshold };
  const kpis = useMemo(() => analysisKpis({ ...input, period: range }), [s.categories, s.transactions, s.commitments, balance, s.today, s.settings.minCashThreshold, range]); // eslint-disable-line react-hooks/exhaustive-deps
  const prevKpis = useMemo(() => analysisKpis({ ...input, period: prev }), [s.categories, s.transactions, s.commitments, balance, s.today, s.settings.minCashThreshold, prev]); // eslint-disable-line react-hooks/exhaustive-deps

  const months = useMemo(() => periodMonthKeys(range), [range]);
  // Évolution : période + 6 mois de prévision (24 mois au plus)
  const chartTo = addMonths(current, 6) > months[months.length - 1]! ? addMonths(current, 6) : months[months.length - 1]!;
  const chartFrom = monthDiff(months[0]!, chartTo) + 1 > 24 ? addMonths(chartTo, -23) : months[0]!;
  const plan = usePlan(chartFrom, monthDiff(chartFrom, chartTo) + 1);
  const scenarios = s.scenarios.filter((x) => !x.archived);
  const [scenarioId, setScenarioId] = useState(scenarios.find((x) => x.isBase)!.id);

  const outBreak = useMemo(() => breakdownByCategory(s.categories, s.transactions, 'out', range), [s.categories, s.transactions, range]);
  const inBreak = useMemo(() => breakdownByCategory(s.categories, s.transactions, 'in', range), [s.categories, s.transactions, range]);
  const bva = useMemo(() => budgetVsActual(plan, scenarioId, s.categories, months.filter((m) => m >= chartFrom)), [plan, scenarioId, s.categories, months, chartFrom]);
  const clients = useMemo(() => topCounterparties(s.transactions, s.commitments, 'in', range, s.today), [s.transactions, s.commitments, range, s.today]);
  const suppliers = useMemo(() => topCounterparties(s.transactions, s.commitments, 'out', range, s.today), [s.transactions, s.commitments, range, s.today]);

  // Catégories suivies : couleur attachée à la catégorie (pas à son rang)
  const defaultCats = [...inBreak.rows.slice(0, 1), ...outBreak.rows.slice(0, 2)].map((r) => r.id).filter((id) => !id.startsWith('__'));
  const [picked, setPicked] = useState<{ id: string; slot: number }[]>(() => defaultCats.map((id, i) => ({ id, slot: i })));
  const pick = (ids: string[]) => {
    const kept = picked.filter((p) => ids.includes(p.id));
    const used = new Set(kept.map((p) => p.slot));
    for (const id of ids) {
      if (kept.some((p) => p.id === id)) continue;
      const slot = [0, 1, 2, 3, 4, 5].find((x) => !used.has(x));
      if (slot === undefined) break;
      used.add(slot);
      kept.push({ id, slot });
    }
    setPicked(kept);
  };
  const catName = (id: string) => s.categories.find((c) => c.id === id)?.name ?? id;
  const sp = plan.scenarios[scenarioId]!;
  const evolution = plan.months.map((m) => {
    const row: Record<string, number | string | null> = { month: formatMonthShort(m), key: m };
    for (const p of picked) {
      const cell = sp.rows[p.id]?.[m];
      const v = cell ? displayValue(cell, m, current) : 0;
      // Réalisé jusqu'au dernier mois complet ; la prévision part de ce mois pour relier les deux traits
      const lastPast = addMonths(current, -1);
      row[`a_${p.id}`] = m <= lastPast ? Math.round(v) : null;
      row[`f_${p.id}`] = m >= lastPast ? Math.round(v) : null;
    }
    return row;
  });

  const synthesis = (() => {
    const net = inBreak.total - outBreak.total;
    return `Du ${dayjs(range.from).format('D MMMM YYYY')} au ${dayjs(range.to).format('D MMMM YYYY')}, vous avez encaissé ${formatEuroRounded(inBreak.total)} et décaissé ${formatEuroRounded(outBreak.total)}, soit un flux net de ${net >= 0 ? '+' : ''}${formatEuroRounded(net)}.`;
  })();

  return (
    <div className="analyses">
      {/* Couverture du rapport PDF (impression seulement) */}
      <header className="print-only report-cover">
        <Logo onDark={false} size={22} />
        <h1>Rapport de trésorerie</h1>
        <p className="report-company">{s.company?.name}</p>
        <p>{synthesis}</p>
        <MotifStrip height={60} />
      </header>

      <div className="analyses-toolbar no-print">
        <DatePicker.RangePicker
          picker="month"
          format="MMM YYYY"
          allowClear={false}
          value={[dayjs(range.from), dayjs(range.to)]}
          onChange={(v) => {
            if (!v?.[0] || !v[1]) return;
            const to = v[1].endOf('month').format('YYYY-MM-DD');
            setRange({ from: v[0].format('YYYY-MM-01'), to: to > s.today ? s.today : to });
          }}
          aria-label="Période analysée"
        />
        <label className="switch-label">
          <Switch size="small" checked={compare} onChange={setCompare} /> Comparer avec la période précédente
        </label>
        <div className="spacer" />
        <Button icon={<ExportOutlined />} onClick={() => setExportOpen(true)}>
          Exporter
        </Button>
        <Button type="primary" icon={<FilePdfOutlined />} onClick={() => window.print()}>
          Télécharger le rapport PDF
        </Button>
      </div>
      <p className="muted no-print synthesis">{synthesis}</p>

      <section aria-label="Indicateurs clés" className="kpi-grid analyses-kpis">
        {KPIS.map((d) => {
          const v = kpis[d.key];
          const p = prevKpis[d.key];
          const delta = compare && v !== null && p !== null && typeof v === 'number' && typeof p === 'number' ? v - p : null;
          const good = delta === null || delta === 0 ? null : (delta > 0) === d.higherIsBetter;
          return (
            <div key={d.key} className="card kpi">
              <div className="eyebrow kpi-head">
                {d.label}
                <Popover
                  trigger="click"
                  content={
                    <div className="kpi-help">
                      <p>{d.help}</p>
                      {d.config && (
                        <p className="muted">{d.config}</p>
                      )}
                    </div>
                  }
                >
                  <button type="button" className="kpi-q no-print" aria-label={`Explication : ${d.label}`}>
                    <QuestionCircleOutlined />
                  </button>
                </Popover>
              </div>
              {v === null ? (
                <div className="kpi-sub kpi-missing">{d.key === 'customerDelay' || d.key === 'supplierDelay' ? `Aucune facture payée ou échue sur la période. ${d.config}` : d.config ? 'Configurez vos catégories pour afficher cet indicateur' : 'Pas assez de données sur la période'}</div>
              ) : (
                <>
                  <div className={`kpi-value num${d.key === 'variableChargesShare' ? ' small' : ''}`}>{d.format(v as number, kpis)}</div>
                  {compare && (
                    <div className={`kpi-sub${good === true ? ' good' : good === false ? ' bad' : ''}`}>
                      {delta === null ? 'Pas de comparaison possible' : delta === 0 ? 'Stable vs période précédente' : `${delta > 0 ? '+' : '−'}${formatDelta(d.key, Math.abs(delta))} vs période précédente`}
                    </div>
                  )}
                </>
              )}
            </div>
          );
        })}
      </section>

      <section className="analyses-row">
        <BreakdownCard title="Où va l’argent" flow="out" data={outBreak} />
        <BreakdownCard title="D’où vient l’argent" flow="in" data={inBreak} />
      </section>

      <section className="card analyses-card">
        <div className="card-head">
          <h2>Évolution par catégorie</h2>
          <div className="card-tools no-print">
            <Select
              mode="multiple"
              maxCount={6}
              value={picked.map((p) => p.id)}
              onChange={pick}
              placeholder="Choisir jusqu’à 6 catégories"
              options={s.categories.filter((c) => !c.isVat).map((c) => ({ value: c.id, label: c.name }))}
              optionFilterProp="label"
              style={{ minWidth: 280, maxWidth: 520 }}
              aria-label="Catégories affichées"
            />
            <Select value={scenarioId} onChange={setScenarioId} options={scenarios.map((x) => ({ value: x.id, label: x.name }))} style={{ minWidth: 180 }} aria-label="Scénario de prévision" />
          </div>
        </div>
        {picked.length === 0 ? (
          <Empty description="Choisissez des catégories à suivre." />
        ) : (
          <>
            <div className="evolution-chart" role="img" aria-label="Évolution mensuelle des catégories choisies : réalisé en trait plein, prévision en pointillés">
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={evolution} margin={{ top: 12, right: 12, bottom: 0, left: 0 }}>
                  <CartesianGrid vertical={false} stroke="var(--opt-border)" />
                  <XAxis dataKey="month" tickLine={false} axisLine={{ stroke: 'var(--opt-border)' }} tick={{ fontSize: 12, fill: 'var(--opt-text-muted)' }} />
                  <YAxis tickFormatter={(v: number) => `${Math.round(v / 1000)} k€`} tickLine={false} axisLine={false} width={56} tick={{ fontSize: 12, fill: 'var(--opt-text-muted)' }} />
                  <ReferenceLine x={formatMonthShort(current)} stroke="var(--opt-orange)" strokeDasharray="2 3" label={{ value: 'Aujourd’hui', position: 'top', fontSize: 11, fill: 'var(--opt-orange-text)' }} />
                  <Tooltip
                    formatter={(v: number, name: string) => [formatEuroRounded(v), name]}
                    contentStyle={{ borderRadius: 8, fontSize: 12, background: 'var(--opt-surface)', borderColor: 'var(--opt-border)' }}
                  />
                  {picked.map((p) => (
                    <Line key={`a_${p.id}`} dataKey={`a_${p.id}`} name={`${catName(p.id)} · réalisé`} stroke={SERIES[p.slot]} strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} connectNulls isAnimationActive={false} />
                  ))}
                  {picked.map((p) => (
                    <Line key={`f_${p.id}`} dataKey={`f_${p.id}`} name={`${catName(p.id)} · prévu`} stroke={SERIES[p.slot]} strokeWidth={2} strokeDasharray="5 4" dot={false} activeDot={{ r: 5 }} connectNulls isAnimationActive={false} legendType="none" />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
            <ul className="series-legend">
              {picked.map((p) => (
                <li key={p.id}>
                  <span className="series-swatch" style={{ background: SERIES[p.slot] }} />
                  {catName(p.id)}
                </li>
              ))}
              <li className="muted">Trait plein : réalisé · pointillés : prévision ({scenarios.find((x) => x.id === scenarioId)?.name})</li>
            </ul>
          </>
        )}
      </section>

      <section className="card analyses-card">
        <div className="card-head">
          <h2>Prévu vs réalisé</h2>
          <span className="muted">
            Mois écoulés et budgétés, {formatMonthShort(months.find((m) => m >= chartFrom) ?? months[0]!)} → {formatMonthShort(addMonths(current, -1))} · {scenarios.find((x) => x.id === scenarioId)?.name}
          </span>
        </div>
        <Table
          size="small"
          rowKey="categoryId"
          pagination={false}
          dataSource={bva}
          locale={{ emptyText: 'Aucun budget ni réalisé sur la période.' }}
          columns={[
            { title: 'Catégorie', dataIndex: 'name', render: (n: string, r) => <span>{n} <span className="muted">· {r.flow === 'in' ? 'encaissement' : 'décaissement'}</span></span> },
            { title: 'Prévu', dataIndex: 'planned', align: 'right', render: (v: number) => <span className="num">{formatEuroRounded(v)}</span> },
            { title: 'Réalisé', dataIndex: 'actual', align: 'right', render: (v: number) => <span className="num">{formatEuroRounded(v)}</span> },
            {
              title: 'Écart',
              dataIndex: 'gap',
              align: 'right',
              render: (g: number, r) => {
                const favorable = r.flow === 'in' ? g >= 0 : g <= 0;
                const max = Math.max(1, ...bva.map((x) => Math.abs(x.gap)));
                return (
                  <span className="gap-cell">
                    <span className="gap-bar" aria-hidden="true">
                      <span className={favorable ? 'ok' : 'ko'} style={{ width: `${(Math.abs(g) / max) * 100}%` }} />
                    </span>
                    <span className={`num ${favorable ? 'pos-text' : 'neg-text'}`}>
                      {g > 0 ? '+' : ''}
                      {formatEuroRounded(g)}
                    </span>
                  </span>
                );
              },
            },
            { title: 'Écart %', dataIndex: 'gapPct', align: 'right', render: (p: number | null) => <span className="num">{p === null ? '—' : `${p > 0 ? '+' : ''}${pctFmt(p)}`}</span> },
          ]}
        />
      </section>

      <section className="analyses-row">
        <CounterpartyCard title="Clients" flow="in" data={clients} />
        <CounterpartyCard title="Fournisseurs" flow="out" data={suppliers} />
      </section>

      <ExportDrawer
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        defaults={{ from: months[0], to: months[months.length - 1], contents: ['budgetVsActual', 'transactions', 'indicators'], scenarioIds: [scenarioId] }}
      />
    </div>
  );
}

function formatDelta(key: keyof AnalysisKpis, v: number): string {
  if (key === 'averageBalance') return formatEuroRounded(v);
  if (key === 'autonomyMonths') return `${v.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} mois`;
  if (key === 'daysBelowThreshold' || key === 'daysBelowZero' || key === 'customerDelay' || key === 'supplierDelay') return `${v} j`;
  return `${v.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} pt`;
}

function BreakdownCard({ title, flow, data }: { title: string; flow: Flow; data: { total: number; rows: BreakdownRow[] } }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const max = Math.max(1, ...data.rows.map((r) => r.amount));
  const toggle = (id: string) =>
    setOpen((o) => {
      const n = new Set(o);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const row = (r: BreakdownRow, depth: number) => (
    <li key={r.id}>
      <div className="bar-row" style={{ paddingLeft: depth * 18 }}>
        <span className="bar-label">
          {r.children.length > 0 ? (
            <button type="button" className="chevron" onClick={() => toggle(r.id)} aria-expanded={open.has(r.id)} aria-label={`${open.has(r.id) ? 'Replier' : 'Déplier'} ${r.name}`}>
              {open.has(r.id) ? <CaretDownOutlined /> : <CaretRightOutlined />}
            </button>
          ) : (
            <span className="chevron-space" />
          )}
          <span className={r.id.startsWith('__') ? 'italic' : undefined}>{r.name}</span>
        </span>
        <AntTooltip title={`${r.name} : ${formatEuro(r.amount)} · ${pctFmt(r.share)} du total`}>
          <span className="bar-track">
            <span className={`bar-fill ${flow}`} style={{ width: `${(r.amount / max) * 100}%` }} />
          </span>
        </AntTooltip>
        <span className="num bar-value">{formatEuroRounded(r.amount)}</span>
        <span className="muted bar-share">{pctFmt(r.share)}</span>
      </div>
      {open.has(r.id) && r.children.length > 0 && <ul>{r.children.map((c) => row(c, depth + 1))}</ul>}
    </li>
  );
  return (
    <div className="card analyses-card">
      <div className="card-head">
        <h2>{title}</h2>
        <span className="num">{formatEuroRounded(data.total)}</span>
      </div>
      {data.rows.length === 0 ? <Empty description="Aucune opération sur la période." /> : <ul className="bar-list">{data.rows.map((r) => row(r, 0))}</ul>}
    </div>
  );
}

function CounterpartyCard({ title, flow, data }: { title: string; flow: Flow; data: ReturnType<typeof topCounterparties> }) {
  return (
    <div className="card analyses-card">
      <div className="card-head">
        <h2>{title}</h2>
        {data.rows.length > 0 && (
          <span className={data.top3Share > 50 ? 'warn-text' : 'muted'}>
            {flow === 'in' ? 'Les 3 premiers clients' : 'Les 3 premiers fournisseurs'} : {pctFmt(data.top3Share)}
          </span>
        )}
      </div>
      <Table
        size="small"
        rowKey="name"
        pagination={false}
        dataSource={data.rows}
        locale={{ emptyText: 'Aucune opération sur la période.' }}
        columns={[
          { title: '#', width: 36, render: (_, __, i) => <span className="muted">{i + 1}</span> },
          { title: flow === 'in' ? 'Client' : 'Fournisseur', dataIndex: 'name', ellipsis: true },
          { title: 'Montant', dataIndex: 'amount', align: 'right', render: (v: number) => <span className="num">{formatEuroRounded(v)}</span> },
          { title: 'Part', dataIndex: 'share', align: 'right', width: 72, render: (v: number) => <span className="num">{pctFmt(v)}</span> },
          { title: 'Délai moyen', dataIndex: 'delay', align: 'right', render: (d: number | null) => (d === null ? <span className="muted">—</span> : <span className={d > 0 ? 'warn-text' : undefined}>{delayText(d)}</span>) },
        ]}
      />
    </div>
  );
}
