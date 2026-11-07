/**
 * Trésorerie au jour le jour (écran 7.7) et alertes (règle 5.13).
 * Réalisé jusqu'à aujourd'hui, puis factures ouvertes (une facture en retard
 * est comptée aujourd'hui, règle 5.5) et, en option, la part des budgets non
 * couverte par des factures, répartie sur les jours restants du mois.
 */
import { addDays, daysBetween, monthOf } from './dates';
import { isOpen, remainingOf } from './invoices';
import { round2, type PlanResult } from './plan';
import type { BankConnection, Category, Commitment, Flow, IsoDate, MonthKey, Transaction } from './types';

export interface DayPoint {
  date: IsoDate;
  inActual: number;
  inPlanned: number;
  outActual: number;
  outPlanned: number;
  opening: number;
  closing: number;
  /** Factures comptées ce jour-là. */
  invoiceIds: string[];
}

/** Part des budgets non couverte par le réalisé et les factures, par mois et par sens. */
export type UncoveredBudget = { month: MonthKey; flow: Flow; amount: number };

export interface ProjectionInput {
  from: IsoDate;
  to: IsoDate;
  today: IsoDate;
  /** Solde actuel des comptes retenus. */
  currentBalance: number;
  transactions: Transaction[];
  commitments: Commitment[];
  /** Échéances simulées (facture → nouvelle date), écran « Décaler ». */
  shifts?: Map<string, IsoDate>;
  /** « Inclure les budgets » : budgets non couverts répartis sur les jours restants du mois. */
  uncovered?: UncoveredBudget[];
}

export function dailyProjection(input: ProjectionInput): DayPoint[] {
  const { from, to, today, transactions, commitments, shifts, uncovered } = input;
  const n = daysBetween(from, to);
  if (n < 0) return [];
  const idx = new Map<IsoDate, number>();
  const points: DayPoint[] = [];
  for (let i = 0; i <= n; i++) {
    const date = addDays(from, i);
    idx.set(date, i);
    points.push({ date, inActual: 0, inPlanned: 0, outActual: 0, outPlanned: 0, opening: 0, closing: 0, invoiceIds: [] });
  }

  // Solde au début de `from` : solde actuel moins tout ce qui s'est passé depuis
  let opening = input.currentBalance;
  for (const t of transactions) {
    if (t.parentId || t.bookedAt > today) continue;
    if (t.bookedAt >= from) opening -= t.amount;
    const i = idx.get(t.bookedAt);
    if (i === undefined) continue;
    if (t.amount >= 0) points[i]!.inActual += t.amount;
    else points[i]!.outActual += -t.amount;
  }

  for (const c of commitments) {
    if (!isOpen(c) || c.hidden) continue;
    let d = shifts?.get(c.id) ?? c.dueAt;
    if (d < today) d = today;
    const i = idx.get(d);
    if (i === undefined) continue;
    const rest = remainingOf(c);
    if (c.flow === 'in') points[i]!.inPlanned += rest;
    else points[i]!.outPlanned += rest;
    points[i]!.invoiceIds.push(c.id);
  }

  for (const u of uncovered ?? []) {
    if (u.amount <= 0) continue;
    const monthEnd = addDays(nextMonth(u.month), -1);
    const start = u.month > monthOf(today) ? u.month : addDays(today, 1);
    if (start > monthEnd) continue;
    const days = daysBetween(start, monthEnd) + 1;
    const perDay = u.amount / days;
    for (let k = 0; k < days; k++) {
      const i = idx.get(addDays(start, k));
      if (i === undefined) continue;
      if (u.flow === 'in') points[i]!.inPlanned += perDay;
      else points[i]!.outPlanned += perDay;
    }
  }

  let bal = opening;
  for (const p of points) {
    p.opening = round2(bal);
    bal += p.inActual + p.inPlanned - p.outActual - p.outPlanned;
    p.closing = round2(bal);
    p.inActual = round2(p.inActual);
    p.inPlanned = round2(p.inPlanned);
    p.outActual = round2(p.outActual);
    p.outPlanned = round2(p.outPlanned);
  }
  return points;
}

const nextMonth = (m: MonthKey): MonthKey => {
  const y = Number(m.slice(0, 4));
  const mo = Number(m.slice(5, 7));
  return mo === 12 ? `${y + 1}-01-01` : `${y}-${String(mo + 1).padStart(2, '0')}-01`;
};

/**
 * Budgets non couverts du plan (scénario donné) : pour chaque mois à partir du
 * mois courant, prévision − réalisé − engagé, par sens (jamais négatif).
 */
export function uncoveredFromPlan(plan: PlanResult, scenarioId: string): UncoveredBudget[] {
  const sp = plan.scenarios[scenarioId];
  if (!sp) return [];
  const out: UncoveredBudget[] = [];
  for (const m of plan.months) {
    if (m < plan.currentMonth) continue;
    for (const flow of ['in', 'out'] as const) {
      const t = sp.totals[flow][m]!;
      out.push({ month: m, flow, amount: round2(Math.max(0, t.forecast - t.actual - t.committed)) });
    }
  }
  return out;
}

export type Granularity = 'day' | 'week' | 'month';

export interface Bucket extends Omit<DayPoint, 'date'> {
  /** Premier jour du regroupement. */
  start: IsoDate;
  end: IsoDate;
}

/** Lundi de la semaine d'une date. */
export function weekStart(d: IsoDate): IsoDate {
  const day = new Date(`${d}T12:00:00Z`).getUTCDay();
  return addDays(d, -((day + 6) % 7));
}

/** Regroupe les jours par semaine (du lundi) ou par mois. */
export function groupPoints(points: DayPoint[], granularity: Granularity): Bucket[] {
  const keyOf = (d: IsoDate) => (granularity === 'day' ? d : granularity === 'week' ? weekStart(d) : monthOf(d));
  const out: Bucket[] = [];
  for (const p of points) {
    const key = keyOf(p.date);
    let b = out[out.length - 1];
    if (!b || keyOf(b.start) !== key) {
      b = { start: p.date, end: p.date, inActual: 0, inPlanned: 0, outActual: 0, outPlanned: 0, opening: p.opening, closing: p.closing, invoiceIds: [] };
      out.push(b);
    }
    b.end = p.date;
    b.inActual = round2(b.inActual + p.inActual);
    b.inPlanned = round2(b.inPlanned + p.inPlanned);
    b.outActual = round2(b.outActual + p.outActual);
    b.outPlanned = round2(b.outPlanned + p.outPlanned);
    b.closing = p.closing;
    b.invoiceIds.push(...p.invoiceIds);
  }
  return out;
}

export interface DailyKpis {
  opening: number;
  closing: number;
  variation: number;
  /** Variation en % du solde de début (`null` si le début est nul). */
  variationPct: number | null;
  low: { date: IsoDate; value: number } | null;
}

export function dailyKpis(points: DayPoint[]): DailyKpis {
  if (!points.length) return { opening: 0, closing: 0, variation: 0, variationPct: null, low: null };
  const opening = points[0]!.opening;
  const closing = points[points.length - 1]!.closing;
  const low = points.reduce((lo, p) => (p.closing < lo.closing ? p : lo), points[0]!);
  const variation = round2(closing - opening);
  return {
    opening,
    closing,
    variation,
    variationPct: opening === 0 ? null : round2((variation / Math.abs(opening)) * 100),
    low: { date: low.date, value: low.closing },
  };
}

// ───────────────────────── Alertes (5.13) ─────────────────────────

export type AlertKind = 'threshold' | 'overdue' | 'budget' | 'sync';

export interface CashAlert {
  /** Identifiant stable (pour « marquer comme lu »). */
  id: string;
  kind: AlertKind;
  severity: 'danger' | 'warning';
  title: string;
  message: string;
  link: string;
}

const eur0 = (n: number) => `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(Math.floor(n))} €`;
const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const shortDate = (d: IsoDate) => `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]}`;

export interface AlertInput {
  today: IsoDate;
  threshold: number;
  /** Projection des 60 prochains jours (factures seules, comme la vue journalière par défaut). */
  projection: DayPoint[];
  commitments: Commitment[];
  categories: Category[];
  /** Plan du scénario de base, pour les dépassements de budget du mois. */
  plan: PlanResult | null;
  connections: BankConnection[];
  now?: Date;
}

export function computeAlerts(input: AlertInput): CashAlert[] {
  const { today, threshold, projection, commitments, categories, plan, connections } = input;
  const alerts: CashAlert[] = [];

  const limit = addDays(today, 60);
  const below = projection.find((p) => p.date >= today && p.date <= limit && p.closing < threshold);
  if (below) {
    alerts.push({
      id: `threshold:${below.date}`,
      kind: 'threshold',
      severity: below.closing < 0 ? 'danger' : 'warning',
      title: 'Trésorerie sous le seuil',
      message: `Votre trésorerie passera sous ${eur0(threshold)} le ${shortDate(below.date)}`.replace(/\.?$/, '.'),
      link: '/journalier',
    });
  }

  const late = commitments.filter((c) => c.flow === 'in' && isOpen(c) && !c.hidden && daysBetween(c.dueAt, today) > 7);
  if (late.length) {
    const total = late.reduce((s, c) => s + remainingOf(c), 0);
    alerts.push({
      id: `overdue:${late.map((c) => c.id).sort().join(',')}`,
      kind: 'overdue',
      severity: 'warning',
      title: 'Factures clients en retard',
      message: `${late.length} facture${late.length > 1 ? 's' : ''} client${late.length > 1 ? 's' : ''} en retard de plus de 7 jours · ${eur0(total)}.`,
      link: '/factures/clients?vue=retard',
    });
  }

  if (plan) {
    const sp = plan.scenarios[plan.baseScenarioId];
    const m = plan.currentMonth;
    const parents = new Set(categories.map((c) => c.parentId).filter(Boolean));
    for (const cat of categories) {
      if (cat.flow !== 'out' || cat.isVat || (parents.has(cat.id) && !cat.budgetAtParent)) continue;
      const cell = sp?.rows[cat.id]?.[m];
      if (!cell || cell.budget <= 0 || cell.actual <= cell.budget * 1.1) continue;
      const over = Math.round(((cell.actual - cell.budget) / cell.budget) * 100);
      alerts.push({
        id: `budget:${m}:${cat.id}`,
        kind: 'budget',
        severity: 'warning',
        title: `Budget dépassé · ${cat.name}`,
        message: `${cat.name} : ${eur0(cell.actual)} réalisés pour ${eur0(cell.budget)} prévus ce mois-ci (+${over} %).`,
        link: '/plan',
      });
    }
  }

  const now = input.now ?? new Date();
  for (const c of connections) {
    if (c.status === 'ok') continue;
    const since = c.lastSyncAt ? now.getTime() - Date.parse(c.lastSyncAt) : Infinity;
    if (since < 24 * 3_600_000) continue;
    alerts.push({
      id: `sync:${c.id}`,
      kind: 'sync',
      severity: c.status === 'error' ? 'danger' : 'warning',
      title: `Synchronisation · ${c.bankName}`,
      message: `La connexion à ${c.bankName} demande votre action depuis plus de 24 h : vos soldes ne sont plus à jour.`,
      link: '/parametres?onglet=banques',
    });
  }
  return alerts;
}
