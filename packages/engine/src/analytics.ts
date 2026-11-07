/**
 * Analyses (écran 7.12) : KPI de la règle 5.9 sur une période, répartition
 * par catégorie, prévu vs réalisé, tiers. Module pur.
 */
import { addDays, daysBetween, monthOf, monthRange, monthDiff } from './dates';
import { dailyBalances, effectiveKind } from './kpis';
import { round2, type PlanResult } from './plan';
import type { Category, CategoryKind, Commitment, Flow, IsoDate, MonthKey, Transaction } from './types';

export interface Period2 {
  from: IsoDate;
  to: IsoDate;
}

/** Période précédente de même durée, juste avant `p`. */
export function previousPeriod(p: Period2): Period2 {
  const days = daysBetween(p.from, p.to);
  const to = addDays(p.from, -1);
  return { from: addDays(to, -days), to };
}

/** Les 12 derniers mois complets jusqu'à aujourd'hui inclus : du 1er de M−11 à aujourd'hui. */
export function last12Months(today: IsoDate): Period2 {
  return { from: shiftMonths(monthOf(today), -11), to: today };
}
const shiftMonths = (m: MonthKey, n: number) => {
  const d = new Date(`${m}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
};

export interface AnalysisKpis {
  /** `null` = non calculable (catégories sans nature, aucune vente…). */
  overheadsOnRevenue: number | null;
  purchasesOnRevenue: number | null;
  payrollOnRevenue: number | null;
  variableChargesShare: number | null;
  daysBelowZero: number;
  daysBelowThreshold: number;
  averageBalance: number;
  autonomyMonths: number | null;
  /** Jours de retard moyens (négatif = avance). */
  customerDelay: number | null;
  supplierDelay: number | null;
}

export interface AnalysisInput {
  categories: Category[];
  transactions: Transaction[];
  commitments: Commitment[];
  /** Solde actuel des comptes analysés. */
  balance: number;
  today: IsoDate;
  threshold: number;
  period: Period2;
}

const ratio = (a: number, b: number) => (b === 0 ? null : round2((a / b) * 100));

/** Sommes du réalisé par nature de catégorie. */
function sumsByKind(categories: Category[], transactions: Transaction[], p: Period2) {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const sums: Record<CategoryKind, number> = { revenue: 0, purchases: 0, overheads: 0, payroll: 0, none: 0 };
  let allOut = 0;
  for (const t of transactions) {
    if (t.hidden || t.isSplit || !t.categoryId || t.bookedAt < p.from || t.bookedAt > p.to) continue;
    const cat = byId.get(t.categoryId);
    if (!cat || cat.isVat) continue;
    const v = cat.flow === 'in' ? t.amount : -t.amount;
    sums[effectiveKind(cat, byId)] += v;
    if (cat.flow === 'out') allOut += v;
  }
  return { sums, allOut };
}

/**
 * Délai moyen de paiement (5.9) : (date de paiement − échéance) des factures
 * payées dans la période, plus (aujourd'hui − échéance) des factures échues
 * non payées. Positif = retard, négatif = avance.
 */
export function averagePaymentDelay(commitments: Commitment[], flow: Flow, p: Period2, today: IsoDate): number | null {
  const delays: number[] = [];
  for (const c of commitments) {
    if (c.flow !== flow || c.hidden || c.replacedBy || c.status === 'cancelled') continue;
    if (c.status === 'paid' && c.paidAt) {
      if (c.paidAt >= p.from && c.paidAt <= p.to) delays.push(daysBetween(c.dueAt, c.paidAt));
    } else if (c.status === 'pending' && c.dueAt < today && c.dueAt <= p.to) {
      delays.push(daysBetween(c.dueAt, today));
    }
  }
  if (!delays.length) return null;
  return Math.round(delays.reduce((s, d) => s + d, 0) / delays.length);
}

export function analysisKpis(input: AnalysisInput): AnalysisKpis {
  const { categories, transactions, commitments, balance, today, threshold, period } = input;
  const { sums, allOut } = sumsByKind(categories, transactions, period);
  const hasKinds = categories.some((c) => c.kind !== 'none');
  const r = (a: number) => (hasKinds ? ratio(a, sums.revenue) : null);

  // Soldes quotidiens réalisés de la période (pas de projection)
  const end = period.to < today ? period.to : today;
  const points = period.from <= end ? dailyBalances(period.from, end, balance, transactions, [], today) : [];
  const closes = points.map((pt) => pt.closing);

  // Autonomie : décaissements mensuels moyens des 3 derniers mois complets
  const current = monthOf(today);
  const from3 = shiftMonths(current, -3);
  let out3 = 0;
  for (const t of transactions) {
    if (t.hidden || t.parentId || t.amount >= 0) continue;
    const m = monthOf(t.bookedAt);
    if (m >= from3 && m < current) out3 += -t.amount;
  }

  return {
    overheadsOnRevenue: r(sums.overheads),
    purchasesOnRevenue: r(sums.purchases),
    payrollOnRevenue: r(sums.payroll),
    variableChargesShare: hasKinds ? ratio(sums.purchases, allOut) : null,
    daysBelowZero: closes.filter((c) => c < 0).length,
    daysBelowThreshold: closes.filter((c) => c < threshold).length,
    averageBalance: closes.length ? Math.round(closes.reduce((s, c) => s + c, 0) / closes.length) : 0,
    autonomyMonths: out3 > 0 ? round2(balance / (out3 / 3)) : null,
    customerDelay: averagePaymentDelay(commitments, 'in', period, today),
    supplierDelay: averagePaymentDelay(commitments, 'out', period, today),
  };
}

// ───────────────────────── Où va l'argent ─────────────────────────

export interface BreakdownRow {
  id: string;
  name: string;
  amount: number;
  /** Part du total du sens, en %. */
  share: number;
  children: BreakdownRow[];
}

/** Encaissements ou décaissements réalisés par catégorie racine, dépliables, triés par montant. */
export function breakdownByCategory(categories: Category[], transactions: Transaction[], flow: Flow, p: Period2): { total: number; rows: BreakdownRow[] } {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const own = new Map<string, number>();
  let uncategorized = 0;
  for (const t of transactions) {
    if (t.hidden || t.isSplit || t.bookedAt < p.from || t.bookedAt > p.to) continue;
    const cat = t.categoryId ? byId.get(t.categoryId) : undefined;
    if (!cat) {
      if (t.amount > 0 === (flow === 'in') && t.amount !== 0) uncategorized += Math.abs(t.amount);
      continue;
    }
    if (cat.flow !== flow) continue;
    own.set(cat.id, (own.get(cat.id) ?? 0) + (flow === 'in' ? t.amount : -t.amount));
  }
  const build = (c: Category): BreakdownRow => {
    const children = categories.filter((k) => k.parentId === c.id).map(build).filter((r) => r.amount !== 0);
    const amount = round2((own.get(c.id) ?? 0) + children.reduce((s, k) => s + k.amount, 0));
    return { id: c.id, name: c.name, amount, share: 0, children: children.sort((a, b) => b.amount - a.amount) };
  };
  const rows = categories.filter((c) => c.flow === flow && !c.parentId).map(build).filter((r) => r.amount !== 0);
  if (uncategorized > 0) rows.push({ id: flow === 'in' ? '__uncat_in' : '__uncat_out', name: 'À catégoriser', amount: round2(uncategorized), share: 0, children: [] });
  const total = round2(rows.reduce((s, r) => s + r.amount, 0));
  const setShare = (r: BreakdownRow) => {
    r.share = total > 0 ? round2((r.amount / total) * 100) : 0;
    r.children.forEach(setShare);
  };
  rows.forEach(setShare);
  return { total, rows: rows.sort((a, b) => b.amount - a.amount) };
}

// ───────────────────────── Prévu vs réalisé ─────────────────────────

export interface BudgetVsActualRow {
  categoryId: string;
  name: string;
  flow: Flow;
  planned: number;
  actual: number;
  /** Réalisé − prévu. */
  gap: number;
  /** Écart en % du prévu (`null` si rien de prévu). */
  gapPct: number | null;
}

/**
 * Prévu vs réalisé (mois écoulés de la période, mois budgétés
 * seulement) pour les catégories feuilles et les parents à budget global,
 * trié par écart absolu.
 */
export function budgetVsActual(plan: PlanResult, scenarioId: string, categories: Category[], months: MonthKey[]): BudgetVsActualRow[] {
  const sp = plan.scenarios[scenarioId];
  if (!sp) return [];
  // Mois écoulés seulement : le mois en cours n'est pas terminé
  const used = months.filter((m) => m < plan.currentMonth);
  const rows: BudgetVsActualRow[] = [];
  for (const c of categories) {
    const cells = sp.rows[c.id];
    if (!cells || c.isVat) continue;
    if (!cells[used[0] ?? '']?.editable) continue;
    // On ne compare que les mois budgétés : un mois sans budget n'est pas un dépassement
    let planned = 0;
    let actual = 0;
    for (const m of used) {
      const b = cells[m]?.budget ?? 0;
      if (b <= 0) continue;
      planned += b;
      actual += cells[m]?.actual ?? 0;
    }
    if (planned === 0) continue;
    const gap = round2(actual - planned);
    rows.push({ categoryId: c.id, name: c.name, flow: c.flow, planned: round2(planned), actual: round2(actual), gap, gapPct: planned ? round2((gap / planned) * 100) : null });
  }
  return rows.sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap));
}

// ───────────────────────── Clients et fournisseurs ─────────────────────────

export interface CounterpartyStat {
  name: string;
  amount: number;
  share: number;
  count: number;
  /** Délai moyen de paiement de ce tiers (jours de retard, négatif = avance). */
  delay: number | null;
}

const normName = (s: string) => s.trim().toLocaleLowerCase('fr').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ');

/** Top 10 des tiers par montant encaissé (`in`) ou décaissé (`out`) sur la période, et concentration. */
export function topCounterparties(
  transactions: Transaction[],
  commitments: Commitment[],
  flow: Flow,
  p: Period2,
  today: IsoDate,
): { rows: CounterpartyStat[]; top3Share: number; total: number } {
  const map = new Map<string, { name: string; amount: number; count: number }>();
  let total = 0;
  for (const t of transactions) {
    if (t.hidden || t.isSplit || t.bookedAt < p.from || t.bookedAt > p.to) continue;
    if (flow === 'in' ? t.amount <= 0 : t.amount >= 0) continue;
    const name = (t.counterparty || t.label).trim();
    if (!name) continue;
    const k = normName(name);
    const e = map.get(k) ?? { name, amount: 0, count: 0 };
    e.amount += Math.abs(t.amount);
    e.count++;
    map.set(k, e);
    total += Math.abs(t.amount);
  }
  const sorted = [...map.entries()].sort((a, b) => b[1].amount - a[1].amount);
  const rows = sorted.slice(0, 10).map(([k, e]) => {
    const own = commitments.filter((c) => normName(c.counterparty) === k);
    return {
      name: e.name,
      amount: round2(e.amount),
      share: total ? round2((e.amount / total) * 100) : 0,
      count: e.count,
      delay: averagePaymentDelay(own, flow, { from: '0000-01-01', to: p.to }, today),
    };
  });
  const top3 = sorted.slice(0, 3).reduce((s, [, e]) => s + e.amount, 0);
  return { rows, top3Share: total ? round2((top3 / total) * 100) : 0, total: round2(total) };
}

/** Mois couverts par une période (du mois de début au mois de fin). */
export function periodMonthKeys(p: Period2): MonthKey[] {
  const a = monthOf(p.from);
  return monthRange(a, monthDiff(a, monthOf(p.to)) + 1);
}
