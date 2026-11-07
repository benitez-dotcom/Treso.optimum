import {
  Bar,
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
import { formatEuroRounded, formatMonthShort, type MonthKey, type PlanResult, type Scenario } from '@optimum/treso-engine';

interface Props {
  plan: PlanResult;
  scenarios: Scenario[];
  threshold: number;
  height?: number;
  showBars?: boolean;
  /** Mois affichés (par défaut tous les mois du plan). */
  months?: MonthKey[];
  /** Survol d'un mois : permet de surligner la colonne correspondante de la grille. */
  onHoverMonth?: (month: MonthKey | null) => void;
}

const k = (v: number) => `${Math.round(v / 1000)} k€`;

/** Barres encaissements / décaissements (réel plein, prévu clair) et courbe de solde par scénario. */
export function TrajectoryChart({ plan, scenarios, threshold, height = 280, showBars = true, months, onHoverMonth }: Props) {
  const base = plan.scenarios[plan.baseScenarioId]!;
  const data = (months ?? plan.months).map((m) => {
    const isPast = m < plan.currentMonth;
    const tin = base.totals.in[m]!;
    const tout = base.totals.out[m]!;
    const row: Record<string, number | string | boolean> = {
      month: formatMonthShort(m),
      key: m,
      inActual: isPast || m === plan.currentMonth ? tin.actual : 0,
      inPlanned: isPast ? 0 : Math.max(0, tin.forecast - (m === plan.currentMonth ? tin.actual : 0)),
      outActual: isPast || m === plan.currentMonth ? tout.actual : 0,
      outPlanned: isPast ? 0 : Math.max(0, tout.forecast - (m === plan.currentMonth ? tout.actual : 0)),
    };
    for (const s of scenarios) row[`closing_${s.id}`] = plan.scenarios[s.id]?.closing[m] ?? 0;
    return row;
  });
  const currentLabel = formatMonthShort(plan.currentMonth);
  const firstFuture = data.findIndex((d) => d.key === plan.currentMonth);
  const lastLabel = data[data.length - 1]?.month as string | undefined;

  return (
    <div style={{ width: '100%', height }}>
      <ResponsiveContainer>
        <ComposedChart
          data={data}
          margin={{ top: 16, right: 8, bottom: 0, left: 0 }}
          barGap={4}
          onMouseMove={(st: { activeTooltipIndex?: number }) => onHoverMonth?.(st?.activeTooltipIndex !== undefined ? ((data[st.activeTooltipIndex]?.key as MonthKey) ?? null) : null)}
          onMouseLeave={() => onHoverMonth?.(null)}
        >
          <defs>
            <linearGradient id="soldeAire" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#114C5C" stopOpacity={0.16} />
              <stop offset="1" stopColor="#114C5C" stopOpacity={0} />
            </linearGradient>
          </defs>
          {firstFuture >= 0 && lastLabel && (
            <ReferenceArea x1={currentLabel} x2={lastLabel} fill="var(--opt-petrol)" fillOpacity={0.04} ifOverflow="extendDomain" />
          )}
          <CartesianGrid vertical={false} stroke="var(--opt-border)" />
          <XAxis dataKey="month" tickLine={false} axisLine={false} tick={{ fill: 'var(--opt-text-muted)', fontSize: 12 }} />
          <YAxis tickFormatter={k} tickLine={false} axisLine={false} width={52} tick={{ fill: 'var(--opt-text-muted)', fontSize: 11 }} />
          <Tooltip
            cursor={{ fill: 'var(--opt-petrol)', fillOpacity: 0.06 }}
            contentStyle={{ borderRadius: 8, border: '1px solid var(--opt-border)', background: 'var(--opt-surface)', color: 'var(--opt-text)' }}
            formatter={(value: number, name: string) => [formatEuroRounded(value), name]}
          />
          {showBars &&
            [
              <Bar key="inA" dataKey="inActual" name="Encaissements réalisés" stackId="in" fill="var(--opt-in)" radius={[0, 0, 0, 0]} maxBarSize={16} />,
              <Bar key="inP" dataKey="inPlanned" name="Encaissements prévus" stackId="in" fill="var(--opt-in-soft)" radius={[3, 3, 0, 0]} maxBarSize={16} />,
              <Bar key="outA" dataKey="outActual" name="Décaissements réalisés" stackId="out" fill="var(--opt-out-flow)" maxBarSize={16} />,
              <Bar key="outP" dataKey="outPlanned" name="Décaissements prévus" stackId="out" fill="var(--opt-out-soft)" radius={[3, 3, 0, 0]} maxBarSize={16} />,
            ]}
          <ReferenceLine
            y={threshold}
            stroke="var(--opt-warning)"
            strokeDasharray="5 4"
            strokeWidth={1.5}
            label={{ value: `Seuil ${formatEuroRounded(threshold)}`, position: 'insideTopRight', fill: 'var(--opt-warning)', fontSize: 11, fontWeight: 700 }}
          />
          <ReferenceLine
            x={currentLabel}
            stroke="var(--opt-out-soft)"
            label={{ value: "Aujourd'hui", position: 'top', fill: 'var(--opt-orange-text)', fontSize: 11, fontWeight: 700 }}
          />
          {scenarios.map((s, i) => (
            <Line
              key={s.id}
              type="monotone"
              dataKey={`closing_${s.id}`}
              name={`Solde fin de mois · ${s.name}`}
              stroke={s.isBase ? 'var(--opt-petrol)' : s.color}
              strokeWidth={2.5}
              strokeDasharray={i === 0 ? undefined : '7 5'}
              dot={{ r: 3, fill: 'var(--opt-surface)', strokeWidth: 2 }}
              activeDot={{ r: 5 }}
              isAnimationActive={false}
            />
          ))}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export function ChartLegend({ scenarios, showBars = true }: { scenarios: Scenario[]; showBars?: boolean }) {
  const item = (color: string, label: string, line = false, dashed = false) => (
    <span key={label} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span
        aria-hidden="true"
        style={
          line
            ? { width: 18, height: 0, borderTop: `3px ${dashed ? 'dashed' : 'solid'} ${color}` }
            : { width: 10, height: 10, borderRadius: 3, background: color }
        }
      />
      {label}
    </span>
  );
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18, fontSize: 13, color: 'var(--opt-text-muted)' }}>
      {showBars && item('var(--opt-in)', 'Encaissements réalisés')}
      {showBars && item('var(--opt-in-soft)', 'Encaissements prévus')}
      {showBars && item('var(--opt-out-flow)', 'Décaissements réalisés')}
      {showBars && item('var(--opt-out-soft)', 'Décaissements prévus')}
      {scenarios.map((s, i) => item(s.isBase ? 'var(--opt-petrol)' : s.color, `Solde · ${s.name}`, true, i > 0))}
    </div>
  );
}
