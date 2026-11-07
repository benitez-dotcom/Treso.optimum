/** Panneau « Exporter » (écran 7.5) : période, contenus, scénarios, format. */
import './exports.css';
import { useMemo, useState } from 'react';
import { App, Button, Checkbox, DatePicker, Drawer, Radio, Select } from 'antd';
import { DownloadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import {
  addDays,
  budgetsSheet,
  budgetVsActualSheet,
  dailySheet,
  EXPORT_CONTENT_LABELS,
  EXPORT_CONTENT_REQUIRED,
  EXPORT_PERIOD_REQUIRED,
  indicatorsSheet,
  indicatorValue,
  invoicesSheet,
  monthOf,
  planSheet,
  transactionsSheet,
  validatePeriod,
  type ExportContent,
  type ExportContext,
  type InvoiceFlowFilter,
  type InvoiceStatusFilter,
  type MonthKey,
  type SheetSpec,
} from '@optimum/treso-engine';
import { useStore } from '../store/useStore';
import { useIndicatorExprs, usePlan } from '../store/selectors';
import { useProjection } from '../store/projection';
import { downloadBlob } from '../components/spreadsheet';
import { writeCsvZip, writeXlsx } from './writer';

export interface ExportDefaults {
  from?: MonthKey;
  to?: MonthKey;
  contents?: ExportContent[];
  scenarioIds?: string[];
  invoiceFlow?: InvoiceFlowFilter;
}

interface Props {
  open: boolean;
  onClose: () => void;
  defaults?: ExportDefaults;
}

export function ExportDrawer({ open, onClose, defaults }: Props) {
  return (
    <Drawer open={open} onClose={onClose} width={480} title="Exporter" destroyOnHidden>
      {open && <ExportForm defaults={defaults ?? {}} onDone={onClose} />}
    </Drawer>
  );
}

const ALL: ExportContent[] = ['plan', 'budgetVsActual', 'budgets', 'transactions', 'invoices', 'daily', 'indicators'];
const PER_SCENARIO = new Set<ExportContent>(['plan', 'budgetVsActual', 'budgets', 'indicators']);

const lastDay = (m: MonthKey) => addDays(dayjs(m).add(1, 'month').format('YYYY-MM-DD'), -1);

function ExportForm({ defaults, onDone }: { defaults: ExportDefaults; onDone: () => void }) {
  const { message } = App.useApp();
  const s = useStore();
  const current = monthOf(s.today);
  const [range, setRange] = useState<[MonthKey, MonthKey] | null>([defaults.from ?? dayjs(current).subtract(2, 'month').format('YYYY-MM-01'), defaults.to ?? dayjs(current).add(9, 'month').format('YYYY-MM-01')]);
  const [contents, setContents] = useState<ExportContent[]>(defaults.contents ?? ['plan']);
  const visibleScenarios = s.scenarios.filter((x) => !x.archived);
  const [scenarioIds, setScenarioIds] = useState<string[]>(defaults.scenarioIds ?? [visibleScenarios.find((x) => x.isBase)!.id]);
  const [invoiceFlow, setInvoiceFlow] = useState<InvoiceFlowFilter>(defaults.invoiceFlow ?? 'both');
  const [invoiceStatus, setInvoiceStatus] = useState<InvoiceStatusFilter>('all');
  const [format, setFormat] = useState<'xlsx' | 'csv'>('xlsx');
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState(false);

  const from = range?.[0] ?? current;
  const to = range?.[1] ?? current;
  const periodError = !range ? EXPORT_PERIOD_REQUIRED : validatePeriod({ from, to });
  const contentError = contents.length === 0 ? EXPORT_CONTENT_REQUIRED : null;
  const scenarioError = contents.some((c) => PER_SCENARIO.has(c)) && scenarioIds.length === 0 ? 'Choisissez au moins un scénario' : null;

  const months = useMemo(() => {
    const out: MonthKey[] = [];
    for (let m = dayjs(from); !m.isAfter(dayjs(to)); m = m.add(1, 'month')) out.push(m.format('YYYY-MM-01'));
    return out;
  }, [from, to]);
  const plan = usePlan(from, Math.max(1, months.length));
  const { points } = useProjection({ from, to: lastDay(to), accountIds: null, includeBudgets: false });
  const indicators = useIndicatorExprs();

  const run = async () => {
    setTouched(true);
    if (periodError || contentError || scenarioError) return;
    setBusy(true);
    try {
      const ctx: ExportContext = {
        companyName: s.company?.name ?? 'Société',
        categories: s.categories,
        accounts: s.accounts,
        scenarios: s.scenarios,
        today: s.today,
        months,
        from,
        to: lastDay(to),
      };
      const chosen = s.scenarios.filter((x) => scenarioIds.includes(x.id));
      const sheets: Omit<SheetSpec, 'name'>[] = [];
      for (const c of ALL.filter((x) => contents.includes(x))) {
        if (c === 'plan') chosen.forEach((sc) => sheets.push(planSheet(plan, sc, ctx)));
        if (c === 'budgetVsActual') chosen.forEach((sc) => sheets.push(budgetVsActualSheet(plan, sc, ctx)));
        if (c === 'budgets') chosen.forEach((sc) => sheets.push(budgetsSheet(s.budgets, sc, ctx)));
        if (c === 'transactions') sheets.push(transactionsSheet(s.transactions, ctx));
        if (c === 'invoices') sheets.push(invoicesSheet(s.commitments, ctx, invoiceFlow, invoiceStatus));
        if (c === 'daily') sheets.push(dailySheet(points));
        if (c === 'indicators')
          chosen.forEach((sc) =>
            sheets.push(
              indicatorsSheet(
                indicators.map((i) => ({ name: i.name, unit: i.unit, values: months.map((m) => (i.expr ? indicatorValue(i.expr, plan, sc.id, m) : null)) })),
                sc,
                ctx,
              ),
            ),
          );
      }
      const stamp = `${(s.company?.name ?? 'tresorerie').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-')}-${s.today}`;
      if (format === 'xlsx') downloadBlob(`treso-${stamp}.xlsx`, await writeXlsx(sheets, { companyName: ctx.companyName, from, to: ctx.to, today: s.today }));
      else downloadBlob(`treso-${stamp}.zip`, await writeCsvZip(sheets));
      message.success(`Export prêt : ${sheets.length} ${format === 'xlsx' ? 'onglet' : 'fichier'}${sheets.length > 1 ? 's' : ''}.`);
      onDone();
    } catch (e) {
      message.error(e instanceof Error ? `L’export a échoué : ${e.message}` : 'L’export a échoué.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="export-form">
      <section>
        <label className="export-label">Période</label>
        <DatePicker.RangePicker
          picker="month"
          format="MMM YYYY"
          value={range ? [dayjs(range[0]), dayjs(range[1])] : null}
          onChange={(v) => setRange(v?.[0] && v[1] ? [v[0].format('YYYY-MM-01'), v[1].format('YYYY-MM-01')] : null)}
          status={touched && periodError ? 'error' : undefined}
          style={{ width: '100%' }}
        />
        {touched && periodError && <span className="field-error">{periodError}</span>}
      </section>

      <section>
        <label className="export-label">Contenu</label>
        <Checkbox.Group value={contents} onChange={(v) => setContents(v as ExportContent[])} className="export-contents">
          {ALL.map((c) => (
            <Checkbox key={c} value={c}>
              {EXPORT_CONTENT_LABELS[c]}
            </Checkbox>
          ))}
        </Checkbox.Group>
        {touched && contentError && <span className="field-error">{contentError}</span>}
        {contents.includes('invoices') && (
          <div className="export-sub">
            <Select<InvoiceFlowFilter>
              value={invoiceFlow}
              onChange={setInvoiceFlow}
              options={[
                { value: 'both', label: 'Clients et fournisseurs' },
                { value: 'in', label: 'Clients' },
                { value: 'out', label: 'Fournisseurs' },
              ]}
            />
            <Select<InvoiceStatusFilter>
              value={invoiceStatus}
              onChange={setInvoiceStatus}
              options={[
                { value: 'all', label: 'Toutes (échéance dans la période)' },
                { value: 'upcoming', label: 'À venir' },
                { value: 'overdue', label: 'En retard' },
              ]}
            />
          </div>
        )}
      </section>

      {contents.some((c) => PER_SCENARIO.has(c)) && (
        <section>
          <label className="export-label">Scénarios</label>
          <Select
            mode="multiple"
            value={scenarioIds}
            onChange={setScenarioIds}
            options={visibleScenarios.map((x) => ({ value: x.id, label: x.name }))}
            status={touched && scenarioError ? 'error' : undefined}
            style={{ width: '100%' }}
          />
          {touched && scenarioError && <span className="field-error">{scenarioError}</span>}
        </section>
      )}

      <section>
        <label className="export-label">Format</label>
        <Radio.Group value={format} onChange={(e) => setFormat(e.target.value)} className="export-format">
          <Radio value="xlsx">Excel (XLSX), un onglet par contenu</Radio>
          <Radio value="csv">CSV, un fichier par contenu (archive ZIP)</Radio>
        </Radio.Group>
      </section>

      <Button type="primary" icon={<DownloadOutlined />} loading={busy} onClick={run} block>
        Exporter
      </Button>
      <p className="muted">Les budgets saisis s’exportent au format du modèle d’import : modifiez-les dans Excel puis réimportez-les depuis le plan.</p>
    </div>
  );
}
