import { useMemo, useState, type ReactNode } from 'react';
import { App, Button, Drawer, Dropdown, Form, Input, InputNumber, Modal, Radio, Segmented, Select, Switch, Tabs, Tooltip } from 'antd';
import { CaretDownOutlined, CaretRightOutlined, EditOutlined, MessageOutlined, PlusOutlined, WarningOutlined } from '@ant-design/icons';
import {
  addMonths,
  displayValue,
  formatDate,
  formatEuro,
  formatEuroRounded,
  formatMonthShort,
  formatPercent,
  formatPlanAmount,
  formatSigned,
  indicatorValue,
  monthDiff,
  monthOf,
  UNCATEGORIZED_IN,
  UNCATEGORIZED_OUT,
  type Flow,
  type MonthKey,
  type PlanCell,
  type ScenarioPlan,
} from '@optimum/treso-engine';
import { useStore } from '../store/useStore';
import { flattenTree, useCurrentBalance, useCurrentMonth, useIndicatorExprs, usePlan } from '../store/selectors';
import { ChartLegend, TrajectoryChart } from '../components/TrajectoryChart';
import { DecisionDot } from '../layout/Brand';
import './plan.css';

type Range = 'rolling' | 'year' | 'six';

const scenarioColors = [
  { value: '#8A6FB0', label: 'Violet' },
  { value: '#C2410C', label: 'Orange' },
  { value: '#5B8C5A', label: 'Vert' },
  { value: '#84ADB7', label: 'Sauge' },
  { value: '#303031', label: 'Encre' },
];

/** Lit un montant saisi en français : « 8 500 », « 8500,50 », « =8500*1,05 ». */
function parseAmount(raw: string): number | null | 'invalid' {
  const s = raw.replace(/\s| |€/g, '').replace(/,/g, '.');
  if (s === '') return null;
  if (s.startsWith('=')) {
    const m = /^=(\d+(?:\.\d+)?)([*/+-])(\d+(?:\.\d+)?)$/.exec(s);
    if (!m) return 'invalid';
    const a = Number(m[1]);
    const b = Number(m[3]);
    const r = m[2] === '*' ? a * b : m[2] === '/' ? (b === 0 ? NaN : a / b) : m[2] === '+' ? a + b : a - b;
    return Number.isFinite(r) && r >= 0 ? Math.round(r * 100) / 100 : 'invalid';
  }
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : 'invalid';
}

interface BudgetInputProps {
  cell: PlanCell;
  label: string;
  altColor: string | null;
  onCommit: (value: number | null) => void;
}

function BudgetInput({ cell, label, altColor, onCommit }: BudgetInputProps) {
  const initial = cell.ownBudget === null ? '' : String(cell.ownBudget).replace('.', ',');
  const [text, setText] = useState(initial);
  const [error, setError] = useState(false);
  const [lastInitial, setLastInitial] = useState(initial);
  if (initial !== lastInitial) {
    setLastInitial(initial);
    setText(initial);
  }
  const commit = () => {
    const v = parseAmount(text);
    if (v === 'invalid') {
      setError(true);
      return;
    }
    setError(false);
    if (v !== cell.ownBudget) onCommit(v);
  };
  return (
    <input
      className={`budget-input num${error ? ' error' : ''}${cell.isAlternative ? ' alt' : ''}`}
      style={cell.isAlternative && altColor ? { borderBottomColor: altColor } : undefined}
      value={text}
      placeholder={cell.ownBudget === null && cell.budget > 0 ? formatPlanAmount(cell.budget) : ''}
      aria-label={label}
      aria-invalid={error}
      inputMode="decimal"
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          commit();
          (e.target as HTMLInputElement).blur();
        }
        if (e.key === 'Escape') {
          setText(initial);
          setError(false);
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}

export function PlanPage() {
  const { message } = App.useApp();
  const current = useCurrentMonth();
  const balance = useCurrentBalance();
  const store = useStore();
  const { categories, scenarios, settings, transactions, commitments } = store;
  const [range, setRange] = useState<Range>('rolling');
  const [scenarioId, setScenarioId] = useState(scenarios.find((s) => s.isBase)!.id);
  const [compare, setCompare] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editPast, setEditPast] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [detail, setDetail] = useState<{ rowId: string; month: MonthKey } | null>(null);
  const [scenarioModal, setScenarioModal] = useState(false);
  const [form] = Form.useForm();

  const [from, count] = useMemo((): [MonthKey, number] => {
    if (range === 'year') return [`${current.slice(0, 4)}-01-01`, 12];
    if (range === 'six') return [current, 6];
    return [addMonths(current, -2), 12];
  }, [range, current]);

  const plan = usePlan(from, count);
  const indicators = useIndicatorExprs();
  const scenario = scenarios.find((s) => s.id === scenarioId) ?? scenarios[0]!;
  const sp: ScenarioPlan = plan.scenarios[scenario.id]!;
  const months = plan.months;
  const isPast = (m: MonthKey) => m < current;
  const chartScenarios = compare ? scenarios : [scenario];

  const lowest = months.filter((m) => m >= current).reduce<MonthKey | null>((lo, m) => (lo === null || sp.closing[m]! < sp.closing[lo]! ? m : lo), null);

  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const treeRows = (flow: Flow) => {
    const all = flattenTree(categories, flow);
    const hiddenParents = new Set<string>();
    const visible = all.filter((r) => {
      if (r.category.parentId && (hiddenParents.has(r.category.parentId) || collapsed.has(r.category.parentId))) {
        hiddenParents.add(r.category.id);
        return false;
      }
      return true;
    });
    return collapsed.has(`total-${flow}`) ? [] : visible;
  };

  const rangeTotal = (cells: Record<MonthKey, PlanCell> | undefined) =>
    cells ? months.reduce((s, m) => s + displayValue(cells[m]!, m, current), 0) : 0;

  const cellText = (cell: PlanCell, m: MonthKey): ReactNode => {
    if (isPast(m)) return formatPlanAmount(cell.actual);
    if (m === current) {
      return (
        <>
          <span className="cell-actual">{formatPlanAmount(cell.actual)}</span>
          <span className="cell-sep"> / </span>
          {formatPlanAmount(cell.forecast)}
        </>
      );
    }
    return formatPlanAmount(cell.forecast);
  };

  const cellClass = (m: MonthKey) => `num${m === current ? ' current' : ''}`;

  const renderCategoryRow = (rowId: string, name: string, depth: number, hasChildren: boolean, italic = false) => {
    const cells = sp.rows[rowId];
    if (!cells) return null;
    return (
      <tr key={rowId} className={italic ? 'row-muted' : undefined}>
        <th scope="row" className="label" style={{ paddingLeft: 16 + depth * 20 + (hasChildren ? 0 : 20) }}>
          {hasChildren && (
            <button type="button" className="chevron" aria-label={collapsed.has(rowId) ? `Déplier ${name}` : `Replier ${name}`} aria-expanded={!collapsed.has(rowId)} onClick={() => toggle(rowId)}>
              {collapsed.has(rowId) ? <CaretRightOutlined /> : <CaretDownOutlined />}
            </button>
          )}
          <span className={italic ? 'italic' : undefined}>{name}</span>
        </th>
        {months.map((m) => {
          const cell = cells[m]!;
          const canEdit = editing && cell.editable && (m >= current || editPast);
          if (canEdit) {
            return (
              <td key={m} className={`${cellClass(m)} editing`}>
                <Dropdown
                  trigger={['contextMenu']}
                  menu={{
                    items: [
                      { key: 'r12', label: 'Répéter sur 12 mois' },
                      { key: 'rend', label: 'Répéter jusqu\'à la fin de la période' },
                      { key: 'r3', label: 'Répéter tous les 3 mois pendant 12 mois' },
                      ...(scenario.isBase ? [] : [{ key: 'base', label: 'Revenir à la valeur de base' }]),
                    ],
                    onClick: ({ key }) => {
                      const amount = cell.ownBudget ?? cell.budget;
                      if (key === 'base') {
                        store.setBudget(scenario.id, rowId, m, null);
                        return;
                      }
                      const duration = key === 'rend' ? monthDiff(m, months[months.length - 1]!) + 1 : 12;
                      store.repeatBudget(scenario.id, rowId, m, amount, key === 'r3' ? 3 : 1, Math.min(36, duration));
                      message.success('Valeur répétée');
                    },
                  }}
                >
                  <div>
                    <BudgetInput
                      cell={cell}
                      altColor={scenario.isBase ? null : scenario.color}
                      label={`Budget ${name}, ${formatMonthShort(m)}`}
                      onCommit={(v) => store.setBudget(scenario.id, rowId, m, v)}
                    />
                  </div>
                </Dropdown>
              </td>
            );
          }
          return (
            <td key={m} className={cellClass(m)}>
              <button
                type="button"
                className={`cell-btn${cell.isAlternative ? ' alt' : ''}`}
                style={cell.isAlternative ? { borderBottomColor: scenario.color } : undefined}
                onClick={() => setDetail({ rowId, month: m })}
                aria-label={`${name}, ${formatMonthShort(m)} : voir le détail`}
              >
                {cellText(cell, m)}
              </button>
            </td>
          );
        })}
        <td className="num total-col">{formatPlanAmount(rangeTotal(cells))}</td>
      </tr>
    );
  };

  const renderFlow = (flow: Flow) => {
    const totals = sp.totals[flow];
    const label = flow === 'in' ? 'Encaissements' : 'Décaissements';
    const key = `total-${flow}`;
    return (
      <>
        <tr className={`row-total ${flow}`}>
          <th scope="row" className="label">
            <button type="button" className="chevron" aria-expanded={!collapsed.has(key)} aria-label={collapsed.has(key) ? `Déplier ${label}` : `Replier ${label}`} onClick={() => toggle(key)}>
              {collapsed.has(key) ? <CaretRightOutlined /> : <CaretDownOutlined />}
            </button>
            {label}
          </th>
          {months.map((m) => (
            <td key={m} className={cellClass(m)}>
              {cellText({ ...totals[m]!, ownBudget: null, isAlternative: false, editable: false } as PlanCell, m)}
            </td>
          ))}
          <td className="num total-col">{formatPlanAmount(months.reduce((s, m) => s + displayValue(totals[m]!, m, current), 0))}</td>
        </tr>
        {treeRows(flow).map((r) => renderCategoryRow(r.category.id, r.category.name, r.depth + 1, r.hasChildren))}
        {!collapsed.has(key) && renderCategoryRow(flow === 'in' ? UNCATEGORIZED_IN : UNCATEGORIZED_OUT, 'À catégoriser', 1, false, true)}
      </>
    );
  };

  const detailCategory = detail ? categories.find((c) => c.id === detail.rowId) : undefined;
  const detailName = detail ? (detailCategory?.name ?? 'À catégoriser') : '';
  const detailCell = detail ? sp.rows[detail.rowId]?.[detail.month] : undefined;
  const detailTx = detail
    ? transactions.filter((t) => monthOf(t.bookedAt) === detail.month && !t.hidden && (detailCategory ? t.categoryId === detailCategory.id : !t.categoryId && (detail.rowId === UNCATEGORIZED_IN ? t.amount > 0 : t.amount < 0)))
    : [];
  const detailInv = detail && detailCategory ? commitments.filter((c) => c.categoryId === detailCategory.id && c.status === 'pending' && (monthOf(c.dueAt) === detail.month || (c.dueAt < store.today && detail.month === current))) : [];

  return (
    <>
      <div className="plan-toolbar">
        <div role="tablist" aria-label="Scénarios" className="scenario-tabs">
          {scenarios.map((s) => (
            <button
              key={s.id}
              role="tab"
              type="button"
              aria-selected={s.id === scenario.id}
              className={`scenario-tab${s.id === scenario.id ? ' active' : ''}`}
              onClick={() => setScenarioId(s.id)}
            >
              <span className="scenario-dot" style={{ background: s.id === scenario.id ? '#fff' : s.isBase ? 'var(--opt-petrol)' : s.color }} />
              {s.name}
            </button>
          ))}
          <button type="button" className="scenario-add" onClick={() => setScenarioModal(true)}>
            <PlusOutlined /> Scénario
          </button>
        </div>
        <Segmented<Range>
          value={range}
          onChange={setRange}
          options={[
            { value: 'rolling', label: '12 mois glissants' },
            { value: 'year', label: 'Année civile' },
            { value: 'six', label: '6 prochains mois' },
          ]}
        />
        <Segmented
          value={settings.forecastMode}
          onChange={(v) => store.setForecastMode(v as 'budget' | 'projection')}
          options={[
            { value: 'budget', label: 'Budget' },
            { value: 'projection', label: 'Projection' },
          ]}
        />
        <label className="switch-label">
          <Switch size="small" checked={compare} onChange={setCompare} /> Comparer les scénarios
        </label>
        <div className="spacer" />
        {editing && (
          <label className="switch-label">
            <Switch size="small" checked={editPast} onChange={setEditPast} /> Inclure les mois passés
          </label>
        )}
        <Button
          type="primary"
          className={editing ? 'cta-orange' : undefined}
          icon={<EditOutlined />}
          onClick={() => setEditing((e) => !e)}
        >
          {editing ? 'Terminer' : 'Modifier les budgets'}
        </Button>
      </div>

      <section className="card plan-chart">
        <div className="plan-chart-summary">
          <span className="eyebrow">Solde aujourd'hui</span>
          <span className="kpi-value num">{formatEuroRounded(balance)}</span>
          {lowest && (
            <span className={sp.closing[lowest]! < settings.minCashThreshold ? 'warn-text' : 'muted'}>
              Point bas : {formatEuroRounded(sp.closing[lowest]!)} fin {formatMonthShort(lowest)}
            </span>
          )}
          <span className="muted">
            Fin {formatMonthShort(months[months.length - 1]!)} : {formatEuroRounded(sp.closing[months[months.length - 1]!]!)}
          </span>
        </div>
        <div className="plan-chart-graph">
          <TrajectoryChart plan={plan} scenarios={chartScenarios} threshold={settings.minCashThreshold} height={220} showBars={!compare} />
          <ChartLegend scenarios={chartScenarios} />
        </div>
      </section>

      {editing && (
        <p className="edit-hint" role="status">
          Saisissez vos budgets comme dans un tableur : Entrée ou Tab pour valider, Échap pour annuler, clic droit pour répéter une valeur.
          {!scenario.isBase && ' Les valeurs laissées vides reprennent celles du scénario de base.'}
        </p>
      )}

      <div className="card plan-table-wrap">
        <table className="plan-table">
          <thead>
            <tr>
              <th scope="col" className="label">
                <button type="button" className="link-btn" onClick={() => setCollapsed(collapsed.size ? new Set() : new Set(categories.filter((c) => categories.some((k) => k.parentId === c.id)).map((c) => c.id)))}>
                  {collapsed.size ? 'Tout déplier' : 'Tout replier'}
                </button>
              </th>
              {months.map((m) => (
                <th key={m} scope="col" className={`num${m === current ? ' current' : ''}`}>
                  {m === current ? (
                    <>
                      <span className="month-current"><DecisionDot size={7} /> {formatMonthShort(m)}</span>
                      <span className="th-sub">réalisé / prévu</span>
                    </>
                  ) : (
                    formatMonthShort(m)
                  )}
                </th>
              ))}
              <th scope="col" className="num total-col">
                Total
                <span className="th-sub">{formatMonthShort(months[0]!)} → {formatMonthShort(months[months.length - 1]!)}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr className="row-strong">
              <th scope="row" className="label">Solde en début de mois</th>
              {months.map((m) => <td key={m} className={cellClass(m)}>{formatPlanAmount(sp.opening[m]!)}</td>)}
              <td className="num total-col">{formatPlanAmount(sp.opening[months[0]!]!)}</td>
            </tr>
            {renderFlow('in')}
            {renderFlow('out')}
            <tr className="row-muted">
              <th scope="row" className="label">Exclu des totaux</th>
              {months.map((m) => <td key={m} className={cellClass(m)}>{formatSigned(sp.hidden[m]!)}</td>)}
              <td className="num total-col">{formatSigned(months.reduce((s, m) => s + sp.hidden[m]!, 0))}</td>
            </tr>
            <tr className="row-strong">
              <th scope="row" className="label">Variation du mois</th>
              {months.map((m) => (
                <td key={m} className={`${cellClass(m)} ${sp.variation[m]! > 0 ? 'pos' : ''}`}>{formatSigned(sp.variation[m]!)}</td>
              ))}
              <td className="num total-col">{formatSigned(months.reduce((s, m) => s + sp.variation[m]!, 0))}</td>
            </tr>
            <tr className="row-closing">
              <th scope="row" className="label">Solde en fin de mois</th>
              {months.map((m) => {
                const v = sp.closing[m]!;
                const state = v < 0 ? 'negative' : v < settings.minCashThreshold ? 'below' : '';
                return (
                  <td key={m} className={`${cellClass(m)} ${state}`}>
                    {state && (
                      <Tooltip title={state === 'negative' ? 'Solde négatif' : 'Sous le seuil de trésorerie minimum'}>
                        <WarningOutlined aria-label={state === 'negative' ? 'Solde négatif' : 'Sous le seuil'} />{' '}
                      </Tooltip>
                    )}
                    {formatPlanAmount(v)}
                  </td>
                );
              })}
              <td className="num total-col">{formatPlanAmount(sp.closing[months[months.length - 1]!]!)}</td>
            </tr>
            {indicators.map((ind) => (
              <tr key={ind.id} className="row-indicator">
                <th scope="row" className="label">{ind.name}</th>
                {months.map((m) => {
                  const v = ind.expr ? indicatorValue(ind.expr, plan, scenario.id, m) : null;
                  return <td key={m} className={cellClass(m)}>{v === null ? '—' : ind.unit === '%' ? formatPercent(v) : `${Math.round(v)} ${ind.unit}`}</td>;
                })}
                <td className="num total-col">—</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted">
        Montants TTC en euros, arrondis à l'euro. Mode {settings.forecastMode === 'projection' ? 'Projection : budgets ajustés des dépassements déjà constatés' : 'Budget : budgets tels que saisis'}.
        Les factures en retard sont reportées au mois courant.
      </p>

      <Drawer
        open={detail !== null}
        onClose={() => setDetail(null)}
        width={480}
        title={detail ? `${detailName} · ${formatMonthShort(detail.month)}` : ''}
      >
        {detail && detailCell && (
          <div className="stack">
            <p className="detail-lead">
              <strong className="num">{formatEuroRounded(detailCell.actual)}</strong> réalisés
              {detailCell.budget > 0 && (
                <>
                  {' '}sur <strong className="num">{formatEuroRounded(detailCell.budget)}</strong> prévus ({Math.round((detailCell.actual / detailCell.budget) * 100)} %)
                </>
              )}
            </p>
            <dl className="detail-list">
              <dt>Réalisé</dt><dd className="num">{formatEuro(detailCell.actual)}</dd>
              <dt>Engagé</dt><dd className="num">{formatEuro(detailCell.committed)}</dd>
              <dt>Budget</dt>
              <dd>
                {detailCell.editable ? (
                  <InputNumber
                    key={`${detail.rowId}-${detail.month}-${scenario.id}`}
                    min={0}
                    defaultValue={detailCell.ownBudget ?? undefined}
                    placeholder={detailCell.budget > 0 ? formatPlanAmount(detailCell.budget) : '0'}
                    formatter={(v) => (v === undefined || v === null || String(v) === '' ? '' : Number(v).toLocaleString('fr-FR'))}
                    parser={(v) => Number((v ?? '').replace(/\s| /g, '').replace(',', '.'))}
                    addonAfter="€"
                    onBlur={(e) => {
                      const v = parseAmount(e.target.value);
                      if (v !== 'invalid') store.setBudget(scenario.id, detail.rowId, detail.month, v);
                    }}
                    aria-label="Budget du mois"
                  />
                ) : (
                  <span className="num">{formatEuro(detailCell.budget)}</span>
                )}
              </dd>
              <dt>{settings.forecastMode === 'projection' ? 'Projection' : 'Prévision'}</dt><dd className="num">{formatEuro(detailCell.forecast)}</dd>
            </dl>
            <Tabs
              items={[
                {
                  key: 'tx',
                  label: `Opérations (${detailTx.length})`,
                  children: (
                    <ul className="detail-items">
                      {detailTx.map((t) => (
                        <li key={t.id}>
                          <span className="muted">{formatDate(t.bookedAt, false)}</span>
                          <span className="ellipsis">{t.counterparty ?? t.label}</span>
                          <span className={`num ${t.amount > 0 ? 'positive' : ''}`}>{formatEuro(t.amount)}</span>
                        </li>
                      ))}
                      {detailTx.length === 0 && <li className="muted">Aucune opération ce mois-ci.</li>}
                    </ul>
                  ),
                },
                {
                  key: 'inv',
                  label: `Factures (${detailInv.length})`,
                  children: (
                    <ul className="detail-items">
                      {detailInv.map((c) => (
                        <li key={c.id}>
                          <span className="muted">{formatDate(c.dueAt, false)}</span>
                          <span className="ellipsis">{c.counterparty} · {c.number}</span>
                          <span className="num">{formatEuro(c.amountInclTax)}</span>
                        </li>
                      ))}
                      {detailInv.length === 0 && <li className="muted">Aucune facture à venir.</li>}
                    </ul>
                  ),
                },
              ]}
            />
            <Button icon={<MessageOutlined />} onClick={() => message.info('Les commentaires arrivent avec le lot 6.')}>Ajouter un commentaire</Button>
          </div>
        )}
      </Drawer>

      <Modal
        open={scenarioModal}
        title="Créer un scénario"
        okText="Créer le scénario"
        cancelText="Annuler"
        onCancel={() => setScenarioModal(false)}
        onOk={() => form.submit()}
        destroyOnClose
      >
        <p className="muted">
          Votre scénario reprend toutes les valeurs du scénario de base. Modifiez uniquement ce qui change : le reste suit automatiquement.
        </p>
        <Form
          form={form}
          layout="vertical"
          initialValues={{ color: scenarioColors[0]!.value, start: 'base' }}
          onFinish={(v: { name: string; color: string; start: string }) => {
            const id = store.addScenario(v.name.trim(), v.color, v.start === 'base' ? undefined : v.start);
            setScenarioId(id);
            setScenarioModal(false);
            setEditing(true);
            message.success(`Scénario « ${v.name.trim()} » créé. Modifiez les valeurs qui changent.`);
          }}
        >
          <Form.Item name="name" label="Nom" rules={[{ required: true, message: 'Donnez un nom à votre scénario.' }]}>
            <Input placeholder="Ex. : Recrutement commercial en mars" />
          </Form.Item>
          <Form.Item name="color" label="Couleur">
            <Radio.Group>
              {scenarioColors.map((c) => (
                <Radio.Button key={c.value} value={c.value} aria-label={c.label}>
                  <span className="scenario-dot" style={{ background: c.value }} /> {c.label}
                </Radio.Button>
              ))}
            </Radio.Group>
          </Form.Item>
          <Form.Item name="start" label="Point de départ">
            <Select
              options={[
                { value: 'base', label: 'Scénario de base' },
                ...scenarios.filter((s) => !s.isBase).map((s) => ({ value: s.id, label: `Copie de « ${s.name} »` })),
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
