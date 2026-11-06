/** Indicateurs de pilotage (règle 5.9) et alertes (5.13). */
import { addDays, addMonths, daysBetween, monthOf } from './dates';
import { round2 } from './plan';
import type { Category, CategoryKind, Commitment, IsoDate, MonthKey, Transaction } from './types';

/** Type effectif d'une catégorie : le sien, sinon celui du parent le plus proche. */
export function effectiveKind(cat: Category, byId: Map<string, Category>): CategoryKind {
  let c: Category | undefined = cat;
  while (c) {
    if (c.kind !== 'none') return c.kind;
    c = c.parentId ? byId.get(c.parentId) : undefined;
  }
  return 'none';
}

export interface RatioKpis {
  overheadsOnRevenue: number;
  purchasesOnRevenue: number;
  payrollOnRevenue: number;
  variableChargesShare: number;
}

const pct = (a: number, b: number) => (a === 0 || b === 0 ? 0 : round2((a / b) * 100));

/** Ratios sur le réalisé entre `from` et `to` inclus. */
export function ratioKpis(categories: Category[], transactions: Transaction[], from: IsoDate, to: IsoDate): RatioKpis {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const sums: Record<CategoryKind, number> = { revenue: 0, purchases: 0, overheads: 0, payroll: 0, none: 0 };
  let allOut = 0;
  for (const t of transactions) {
    if (t.hidden || !t.categoryId || t.bookedAt < from || t.bookedAt > to) continue;
    const cat = byId.get(t.categoryId);
    if (!cat) continue;
    const v = cat.flow === 'in' ? t.amount : -t.amount;
    sums[effectiveKind(cat, byId)] += v;
    if (cat.flow === 'out') allOut += v;
  }
  return {
    overheadsOnRevenue: pct(sums.overheads, sums.revenue),
    purchasesOnRevenue: pct(sums.purchases, sums.revenue),
    payrollOnRevenue: pct(sums.payroll, sums.revenue),
    variableChargesShare: pct(sums.purchases, allOut),
  };
}

/**
 * Autonomie de trésorerie, en mois : solde actuel ÷ moyenne des
 * décaissements mensuels des 3 derniers mois complets.
 */
export function cashAutonomyMonths(balance: number, transactions: Transaction[], today: IsoDate): number | null {
  const current = monthOf(today);
  const from = addMonths(current, -3);
  let out = 0;
  for (const t of transactions) {
    if (t.hidden || t.amount >= 0) continue;
    const m = monthOf(t.bookedAt);
    if (m >= from && m < current) out += -t.amount;
  }
  const avg = out / 3;
  return avg > 0 ? round2(balance / avg) : null;
}

export interface DailyPoint {
  date: IsoDate;
  inflow: number;
  outflow: number;
  closing: number;
  projected: boolean;
}

/**
 * Soldes quotidiens : réalisé jusqu'à aujourd'hui, puis projection des
 * factures non payées (une facture en retard est comptée aujourd'hui, règle 5.5).
 */
export function dailyBalances(
  from: IsoDate,
  to: IsoDate,
  currentBalance: number,
  transactions: Transaction[],
  commitments: Commitment[],
  today: IsoDate,
): DailyPoint[] {
  const flows = new Map<IsoDate, { inflow: number; outflow: number }>();
  const add = (d: IsoDate, amount: number) => {
    const f = flows.get(d) ?? { inflow: 0, outflow: 0 };
    if (amount >= 0) f.inflow += amount;
    else f.outflow += -amount;
    flows.set(d, f);
  };
  let opening = currentBalance;
  for (const t of transactions) {
    if (t.bookedAt >= from && t.bookedAt <= today) {
      opening -= t.amount;
      add(t.bookedAt, t.amount);
    }
  }
  for (const c of commitments) {
    if (c.status !== 'pending' || c.hidden) continue;
    const remaining = c.amountInclTax - (c.amountPaid ?? 0);
    if (remaining <= 0) continue;
    const d = c.dueAt < today ? today : c.dueAt;
    if (d >= from && d <= to) add(d, c.flow === 'in' ? remaining : -remaining);
  }
  const out: DailyPoint[] = [];
  let bal = opening;
  const n = daysBetween(from, to);
  for (let i = 0; i <= n; i++) {
    const date = addDays(from, i);
    const f = flows.get(date) ?? { inflow: 0, outflow: 0 };
    bal += f.inflow - f.outflow;
    out.push({ date, inflow: round2(f.inflow), outflow: round2(f.outflow), closing: round2(bal), projected: date > today });
  }
  return out;
}

/** Premier jour où le solde projeté passe sous le seuil (alerte 5.13). */
export function firstDayBelow(points: DailyPoint[], threshold: number, today: IsoDate): DailyPoint | null {
  return points.find((p) => p.date >= today && p.closing < threshold) ?? null;
}

/** Jours de retard d'une facture non payée (0 si à échoir). */
export function daysOverdue(c: Commitment, today: IsoDate): number {
  if (c.status !== 'pending' || c.dueAt >= today) return 0;
  return daysBetween(c.dueAt, today);
}

export type { MonthKey };
