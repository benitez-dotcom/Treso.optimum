/** Comparer des scénarios : solde de fin de mois de chaque scénario et écart au scénario de base. */
import { useMemo } from 'react';
import { Checkbox } from 'antd';
import { compareScenarios, formatMonthShort, formatPlanAmount, formatSigned, type MonthKey, type PlanResult, type Scenario } from '@optimum/treso-engine';

interface Props {
  plan: PlanResult;
  months: MonthKey[];
  scenarios: Scenario[];
  selected: string[];
  current: MonthKey;
  threshold: number;
  highlightMonth: MonthKey | null;
  onSelect: (ids: string[]) => void;
}

export function ComparisonView({ plan, months, scenarios, selected, current, threshold, highlightMonth, onSelect }: Props) {
  const shown = scenarios.filter((s) => selected.includes(s.id));
  const rows = useMemo(() => {
    const all = compareScenarios(plan, shown.map((s) => s.id));
    const set = new Set(months);
    return all.filter((r) => set.has(r.month));
  }, [plan, shown, months]);
  const last = rows[rows.length - 1];
  const colClass = (m: MonthKey) => `num${m === current ? ' current' : ''}${m === highlightMonth ? ' hl' : ''}`;

  return (
    <div className="card plan-table-wrap compare-wrap">
      <div className="compare-pick">
        <span className="eyebrow">Scénarios comparés</span>
        <Checkbox.Group
          value={selected}
          onChange={(v) => onSelect(v as string[])}
          options={scenarios.map((s) => ({
            value: s.id,
            disabled: s.isBase,
            label: (
              <span className="compare-opt">
                <span className="scenario-dot" style={{ background: s.isBase ? 'var(--opt-petrol)' : s.color }} />
                {s.name}
              </span>
            ),
          }))}
        />
      </div>
      <table className="plan-table">
        <thead>
          <tr>
            <th scope="col" className="label">Solde en fin de mois</th>
            {months.map((m) => (
              <th key={m} scope="col" className={colClass(m)}>
                {formatMonthShort(m)}
              </th>
            ))}
            <th scope="col" className="num total-col">
              Écart final
            </th>
          </tr>
        </thead>
        <tbody>
          {shown.map((s) => (
            <tr key={s.id} className={s.isBase ? 'row-strong' : undefined}>
              <th scope="row" className="label">
                <span className="compare-opt">
                  <span className="scenario-dot" style={{ background: s.isBase ? 'var(--opt-petrol)' : s.color }} />
                  {s.name}
                </span>
              </th>
              {rows.map((r) => {
                const v = r.closing[s.id]!;
                return (
                  <td key={r.month} className={`${colClass(r.month)}${v < 0 ? ' neg-text' : v < threshold ? ' warn-cell' : ''}`}>
                    {formatPlanAmount(v)}
                  </td>
                );
              })}
              <td className="num total-col">{s.isBase ? '—' : formatSigned(last?.gap[s.id] ?? 0)}</td>
            </tr>
          ))}
          {shown
            .filter((s) => !s.isBase)
            .map((s) => (
              <tr key={`gap-${s.id}`} className="row-muted">
                <th scope="row" className="label">Écart · {s.name}</th>
                {rows.map((r) => {
                  const g = r.gap[s.id]!;
                  return (
                    <td key={r.month} className={`${colClass(r.month)}${g > 0 ? ' pos-text' : g < 0 ? ' neg-text' : ''}`}>
                      {formatSigned(g)}
                    </td>
                  );
                })}
                <td className="num total-col" />
              </tr>
            ))}
        </tbody>
      </table>
      {shown.length < 2 && <p className="muted compare-empty">Cochez au moins un scénario alternatif pour voir l’écart au scénario de base.</p>}
    </div>
  );
}
