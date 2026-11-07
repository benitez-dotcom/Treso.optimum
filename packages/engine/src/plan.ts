/**
 * Calcul du plan de trésorerie (cahier des charges, règles 5.1 à 5.5).
 * Module pur : aucune dépendance à l'interface ni au réseau.
 */
import { monthOf } from './dates';
import { countsInBalance, countsInCategories } from './types';
import type {
  Budget,
  Category,
  Commitment,
  Flow,
  ForecastMode,
  IsoDate,
  MonthKey,
  Scenario,
  Transaction,
} from './types';

export const UNCATEGORIZED_IN = '__uncat_in';
export const UNCATEGORIZED_OUT = '__uncat_out';

export type OverdueInPlan = 'current_month' | 'due_month';

export interface PlanInput {
  categories: Category[];
  transactions: Transaction[];
  commitments: Commitment[];
  budgets: Budget[];
  scenarios: Scenario[];
  months: MonthKey[];
  today: IsoDate;
  mode: ForecastMode;
  /** Solde réel des comptes au 1er du premier mois affiché. */
  openingBalance: number;
  invoicesEnabled?: boolean;
  overdueInPlan?: OverdueInPlan;
}

export interface PlanCell {
  /** Réalisé (montant positif dans le sens de la catégorie). */
  actual: number;
  /** Engagé : factures non payées échues dans le mois. */
  committed: number;
  /** Budget retenu (après héritage du scénario de base). */
  budget: number;
  /** Valeur saisie dans ce scénario (`null` = héritée ou vide). */
  ownBudget: number | null;
  /** Prévision du mois (règle 5.3). */
  forecast: number;
  /** Valeur redéfinie dans un scénario alternatif (règle 5.2). */
  isAlternative: boolean;
  /** Budget de la ligne saisissable directement (feuille ou parent à budget global). */
  editable: boolean;
}

export interface MonthTotals {
  actual: number;
  committed: number;
  budget: number;
  forecast: number;
}

export interface ScenarioPlan {
  scenarioId: string;
  rows: Record<string, Record<MonthKey, PlanCell>>;
  totals: Record<Flow, Record<MonthKey, MonthTotals>>;
  hidden: Record<MonthKey, number>;
  opening: Record<MonthKey, number>;
  closing: Record<MonthKey, number>;
  variation: Record<MonthKey, number>;
}

export interface PlanResult {
  months: MonthKey[];
  currentMonth: MonthKey;
  baseScenarioId: string;
  scenarios: Record<string, ScenarioPlan>;
  /** Factures en retard reportées au mois courant (montant par ligne et par mois, règle 5.5). */
  overdue: Record<string, Record<MonthKey, number>>;
}

interface OwnAggregate {
  actual: number;
  committed: number;
}

const zero = (): OwnAggregate => ({ actual: 0, committed: 0 });

/** Arrondi au centime pour éviter les erreurs de virgule flottante. */
export const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Valeur budgétée d'un scénario « calque » (règle 5.2). */
export function plannedValue(own: number | null, base: number | null): number {
  if (own !== null) return own;
  if (base !== null) return base;
  return 0;
}

export function isAlternativeValue(
  scenarioId: string,
  baseId: string,
  own: number | null,
  base: number | null,
): boolean {
  return scenarioId !== baseId && own !== null && own !== base;
}

export function computePlan(input: PlanInput): PlanResult {
  const {
    categories,
    transactions,
    commitments,
    budgets,
    scenarios,
    months,
    today,
    mode,
    openingBalance,
    invoicesEnabled = true,
    overdueInPlan = 'current_month',
  } = input;

  const base = scenarios.find((s) => s.isBase) ?? scenarios[0];
  if (!base) throw new Error('Au moins un scénario est requis.');
  const currentMonth = monthOf(today);
  const monthSet = new Set(months);

  const byId = new Map(categories.map((c) => [c.id, c]));
  const children = new Map<string | null, Category[]>();
  for (const c of categories) {
    const list = children.get(c.parentId) ?? [];
    list.push(c);
    children.set(c.parentId, list);
  }
  for (const list of children.values()) list.sort((a, b) => a.position - b.position);

  // 5.1 — agrégats propres à chaque ligne (sans les sous-catégories)
  const own = new Map<string, Map<MonthKey, OwnAggregate>>();
  const overdue: Record<string, Record<MonthKey, number>> = {};
  const hidden = new Map<MonthKey, number>(months.map((m) => [m, 0]));
  const bump = (rowId: string, month: MonthKey, key: keyof OwnAggregate, value: number) => {
    let row = own.get(rowId);
    if (!row) {
      row = new Map();
      own.set(rowId, row);
    }
    const cell = row.get(month) ?? zero();
    cell[key] = round2(cell[key] + value);
    row.set(month, cell);
  };

  for (const t of transactions) {
    if (!countsInCategories(t)) continue;
    const month = monthOf(t.bookedAt);
    if (!monthSet.has(month)) continue;
    if (t.hidden) {
      hidden.set(month, round2((hidden.get(month) ?? 0) + t.amount));
      continue;
    }
    const cat = t.categoryId ? byId.get(t.categoryId) : undefined;
    if (!cat) {
      bump(t.amount >= 0 ? UNCATEGORIZED_IN : UNCATEGORIZED_OUT, month, 'actual', Math.abs(t.amount));
      continue;
    }
    bump(cat.id, month, 'actual', cat.flow === 'in' ? t.amount : -t.amount);
  }

  if (invoicesEnabled) {
    for (const c of commitments) {
      if (c.status !== 'pending' || c.replacedBy) continue;
      const remaining = round2(c.amountInclTax - (c.amountPaid ?? 0));
      if (remaining <= 0) continue;
      let month = monthOf(c.dueAt);
      const late = c.dueAt < today && overdueInPlan === 'current_month' && month < currentMonth;
      if (late) month = currentMonth;
      if (!monthSet.has(month)) continue;
      if (late && !c.hidden) {
        const rowId = c.categoryId && byId.has(c.categoryId) ? c.categoryId : c.flow === 'in' ? UNCATEGORIZED_IN : UNCATEGORIZED_OUT;
        const row = (overdue[rowId] ??= {});
        row[month] = round2((row[month] ?? 0) + remaining);
      }
      if (c.hidden) {
        if (month >= currentMonth) {
          hidden.set(month, round2((hidden.get(month) ?? 0) + (c.flow === 'in' ? remaining : -remaining)));
        }
        continue;
      }
      const cat = c.categoryId ? byId.get(c.categoryId) : undefined;
      if (!cat) {
        bump(c.flow === 'in' ? UNCATEGORIZED_IN : UNCATEGORIZED_OUT, month, 'committed', remaining);
        continue;
      }
      bump(cat.id, month, 'committed', cat.flow === c.flow ? remaining : -remaining);
    }
  }

  const budgetIndex = new Map<string, number | null>();
  for (const b of budgets) budgetIndex.set(`${b.scenarioId}|${b.categoryId}|${b.month}`, b.amount);
  const budgetOf = (s: string, cat: string, m: MonthKey): number | null =>
    budgetIndex.get(`${s}|${cat}|${m}`) ?? null;

  const underGrouper = (cat: Category): boolean => {
    let p = cat.parentId ? byId.get(cat.parentId) : undefined;
    while (p) {
      if (p.budgetAtParent) return true;
      p = p.parentId ? byId.get(p.parentId) : undefined;
    }
    return false;
  };

  const result: Record<string, ScenarioPlan> = {};

  for (const scenario of scenarios) {
    const rows: Record<string, Record<MonthKey, PlanCell>> = {};

    const computeRow = (cat: Category): Record<MonthKey, PlanCell> => {
      const kids = (children.get(cat.id) ?? []).map((k) => ({ cat: k, cells: computeRow(k) }));
      const out: Record<MonthKey, PlanCell> = {};
      const grouped = underGrouper(cat);
      for (const m of months) {
        const mine = own.get(cat.id)?.get(m) ?? zero();
        const subActual = round2(mine.actual + kids.reduce((s, k) => s + k.cells[m]!.actual, 0));
        const subCommitted = round2(mine.committed + kids.reduce((s, k) => s + k.cells[m]!.committed, 0));
        const ownBudget = budgetOf(scenario.id, cat.id, m);
        const baseBudget = budgetOf(base.id, cat.id, m);
        const planned = plannedValue(ownBudget, baseBudget);
        let cell: PlanCell;
        if (grouped) {
          cell = { actual: subActual, committed: subCommitted, budget: 0, ownBudget: null, forecast: round2(subActual + subCommitted), isAlternative: false, editable: false };
        } else if (cat.budgetAtParent || kids.length === 0) {
          const realised = round2(subActual + subCommitted);
          cell = {
            actual: subActual,
            committed: subCommitted,
            budget: planned,
            ownBudget,
            forecast: mode === 'budget' ? planned : Math.max(realised, planned),
            isAlternative: isAlternativeValue(scenario.id, base.id, ownBudget, baseBudget),
            editable: true,
          };
        } else {
          cell = {
            actual: subActual,
            committed: subCommitted,
            budget: round2(kids.reduce((s, k) => s + k.cells[m]!.budget, 0)),
            ownBudget: null,
            forecast: round2(mine.actual + mine.committed + kids.reduce((s, k) => s + k.cells[m]!.forecast, 0)),
            isAlternative: false,
            editable: false,
          };
        }
        out[m] = cell;
      }
      rows[cat.id] = out;
      return out;
    };

    const roots = children.get(null) ?? [];
    const rootCells: Record<Flow, Record<MonthKey, PlanCell>[]> = { in: [], out: [] };
    for (const r of roots) rootCells[r.flow].push(computeRow(r));

    for (const [rowId, flow] of [[UNCATEGORIZED_IN, 'in'], [UNCATEGORIZED_OUT, 'out']] as const) {
      const cells: Record<MonthKey, PlanCell> = {};
      for (const m of months) {
        const mine = own.get(rowId)?.get(m) ?? zero();
        cells[m] = { actual: mine.actual, committed: mine.committed, budget: 0, ownBudget: null, forecast: round2(mine.actual + mine.committed), isAlternative: false, editable: false };
      }
      rows[rowId] = cells;
      rootCells[flow].push(cells);
    }

    const totals: Record<Flow, Record<MonthKey, MonthTotals>> = { in: {}, out: {} };
    for (const flow of ['in', 'out'] as const) {
      for (const m of months) {
        const t = { actual: 0, committed: 0, budget: 0, forecast: 0 };
        for (const cells of rootCells[flow]) {
          const c = cells[m]!;
          t.actual += c.actual;
          t.committed += c.committed;
          t.budget += c.budget;
          t.forecast += c.forecast;
        }
        if (mode === 'budget') t.forecast = Math.max(t.actual + t.committed, t.forecast);
        totals[flow][m] = { actual: round2(t.actual), committed: round2(t.committed), budget: round2(t.budget), forecast: round2(t.forecast) };
      }
    }

    // 5.4 — soldes enchaînés
    const opening: Record<MonthKey, number> = {};
    const closing: Record<MonthKey, number> = {};
    const variation: Record<MonthKey, number> = {};
    const hiddenRec: Record<MonthKey, number> = {};
    let previous = openingBalance;
    for (const m of months) {
      const isPast = m < currentMonth;
      const tin = totals.in[m]!;
      const tout = totals.out[m]!;
      const net = isPast ? tin.actual - tout.actual : tin.forecast - tout.forecast;
      const h = hidden.get(m) ?? 0;
      opening[m] = round2(previous);
      closing[m] = round2(previous + h + net);
      variation[m] = round2(closing[m] - opening[m]);
      hiddenRec[m] = h;
      previous = closing[m];
    }

    result[scenario.id] = { scenarioId: scenario.id, rows, totals, hidden: hiddenRec, opening, closing, variation };
  }

  return { months, currentMonth, baseScenarioId: base.id, scenarios: result, overdue };
}

/**
 * Solde au 1er d'un mois, reconstitué depuis le solde actuel :
 * solde actuel − opérations réalisées depuis ce mois (y compris exclues).
 */
export function openingBalanceAt(
  month: MonthKey,
  currentBalance: number,
  transactions: Transaction[],
  today: IsoDate,
): number {
  let total = currentBalance;
  for (const t of transactions) {
    if (!countsInBalance(t)) continue;
    if (t.bookedAt >= month && t.bookedAt <= today) total -= t.amount;
  }
  return round2(total);
}

/** Valeur à afficher dans une cellule : réel au passé, prévision sinon. */
export function displayValue(cell: Pick<PlanCell, 'actual' | 'forecast'>, month: MonthKey, currentMonth: MonthKey): number {
  return month < currentMonth ? cell.actual : cell.forecast;
}
