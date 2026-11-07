/**
 * Construction du plan de trésorerie (écran 7.4) : saisie type tableur,
 * collage depuis Excel, hausses en %, période affichée, assistant prévisionnel
 * et comparaison de scénarios. Module pur.
 */
import { parseAmount } from './bank';
import { addMonths, monthDiff, monthOf, monthRange } from './dates';
import { evaluate, FormulaError, parseFormula } from './indicators';
import { round2, type PlanResult } from './plan';
import type { Budget, Category, MonthKey, Transaction } from './types';

// ───────────────────────── Saisie d'une cellule ─────────────────────────

export type CellInput = { ok: true; value: number | null } | { ok: false; error: string };

/**
 * Interprète la saisie d'une cellule budgétaire : « 8 500 », « 8500,50 € »,
 * formule « =8500*1,05 » ou « =(1200+300)*3 ». Vide = effacer (héritage).
 */
export function parseCellInput(raw: string): CellInput {
  const text = raw.trim();
  if (text === '' || text === '—' || text === '-') return { ok: true, value: null };
  if (text.startsWith('=')) {
    const src = text.slice(1).replace(/[\s  €]/g, '').replace(/(\d),(\d)/g, '$1.$2');
    if (!src) return { ok: false, error: 'Formule incomplète.' };
    try {
      const expr = parseFormula(src, () => null);
      const v = evaluate(expr, () => 0);
      if (v === null || !Number.isFinite(v)) return { ok: false, error: 'Division par zéro.' };
      if (v < 0) return { ok: false, error: 'Un budget ne peut pas être négatif.' };
      return { ok: true, value: round2(v) };
    } catch (e) {
      return { ok: false, error: e instanceof FormulaError ? e.message : 'Formule invalide.' };
    }
  }
  const n = parseAmount(text);
  if (n === null) return { ok: false, error: 'Saisissez un montant, par exemple 8 500 ou =8500*1,05.' };
  if (n < 0) return { ok: false, error: 'Un budget ne peut pas être négatif.' };
  return { ok: true, value: n };
}

// ───────────────────────── Collage depuis Excel ─────────────────────────

/** Une cellule collée : nombre, `null` (cellule vide = effacer) ou texte illisible. */
export type PastedCell = number | null | { invalid: string };

/**
 * Découpe un presse-papiers de tableur (colonnes séparées par tabulation,
 * lignes par retour à la ligne). Les montants négatifs sont pris en valeur
 * absolue : le sens est porté par la catégorie.
 */
export function parsePastedGrid(text: string): PastedCell[][] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  while (lines.length && lines[lines.length - 1]!.trim() === '') lines.pop();
  return lines.map((line) =>
    line.split('\t').map((raw): PastedCell => {
      const t = raw.trim().replace(/^"|"$/g, '');
      if (t === '' || t === '—' || t === '-') return null;
      const r = parseCellInput(t);
      if (r.ok) return r.value;
      const n = parseAmount(t);
      return n === null ? { invalid: t } : Math.abs(n);
    }),
  );
}

export interface PasteTarget {
  scenarioId: string;
  /** Lignes saisissables, dans l'ordre d'affichage. */
  rowIds: string[];
  /** Mois affichés, dans l'ordre. */
  months: MonthKey[];
  startRow: number;
  startMonth: number;
  /** Une cellule est-elle modifiable (mois passé verrouillé, etc.) ? */
  canEdit?: (rowId: string, month: MonthKey) => boolean;
}

export interface PasteResult {
  changes: Budget[];
  /** Cellules hors de la grille, verrouillées ou illisibles. */
  skipped: number;
  invalid: string[];
}

/** Transforme une plage collée en budgets, à partir de la cellule active. */
export function pasteToBudgets(grid: PastedCell[][], target: PasteTarget): PasteResult {
  const changes: Budget[] = [];
  const invalid: string[] = [];
  let skipped = 0;
  grid.forEach((line, i) => {
    line.forEach((value, j) => {
      const rowId = target.rowIds[target.startRow + i];
      const month = target.months[target.startMonth + j];
      if (!rowId || !month || (target.canEdit && !target.canEdit(rowId, month))) {
        skipped++;
        return;
      }
      if (value !== null && typeof value === 'object') {
        invalid.push(value.invalid);
        skipped++;
        return;
      }
      changes.push({ scenarioId: target.scenarioId, categoryId: rowId, month, amount: value });
    });
  });
  return { changes, skipped, invalid };
}

/** Plage de cellules → texte tabulé, pour copier vers Excel. */
export function gridToClipboard(values: (number | null)[][]): string {
  return values.map((row) => row.map((v) => (v === null ? '' : String(v).replace('.', ','))).join('\t')).join('\n');
}

// ───────────────────────── Actions de cellule ─────────────────────────

/**
 * « Augmenter de x % jusqu'à la fin de la période » : chaque mois de `from`
 * à `to` reçoit sa valeur actuelle majorée de `percent` %.
 */
export function increaseUntil(
  scenarioId: string,
  categoryId: string,
  months: MonthKey[],
  from: MonthKey,
  percent: number,
  valueOf: (month: MonthKey) => number,
): Budget[] {
  if (!Number.isFinite(percent) || percent <= -100) throw new RangeError('Le pourcentage doit être supérieur à −100 %.');
  return months
    .filter((m) => m >= from)
    .map((month) => ({ scenarioId, categoryId, month, amount: round2(Math.max(0, valueOf(month) * (1 + percent / 100))) }));
}

/** Recopie vers la droite (poignée de recopie) : même valeur sur les mois suivants. */
export function fillRight(scenarioId: string, categoryId: string, months: MonthKey[], from: MonthKey, to: MonthKey, amount: number | null): Budget[] {
  return months.filter((m) => m > from && m <= to).map((month) => ({ scenarioId, categoryId, month, amount }));
}

// ───────────────────────── Période affichée ─────────────────────────

export type PeriodPreset = 'rolling' | 'calendar' | 'fiscal' | 'custom';
export const MAX_PERIOD_MONTHS = 24;
export const PERIOD_TOO_LONG = 'La période ne peut pas dépasser 24 mois.';

export interface Period {
  from: MonthKey;
  to: MonthKey;
}

/**
 * Préréglages : 12 mois glissants (M−2 → M+9), année civile, exercice
 * (premier mois de l'exercice `fiscalStartMonth`, 1 = janvier).
 */
export function presetPeriod(preset: Exclude<PeriodPreset, 'custom'>, currentMonth: MonthKey, fiscalStartMonth = 1): Period {
  if (preset === 'rolling') return { from: addMonths(currentMonth, -2), to: addMonths(currentMonth, 9) };
  if (preset === 'calendar') {
    const y = currentMonth.slice(0, 4);
    return { from: `${y}-01-01`, to: `${y}-12-01` };
  }
  const month = Number(currentMonth.slice(5, 7));
  const year = Number(currentMonth.slice(0, 4)) - (month < fiscalStartMonth ? 1 : 0);
  const from = `${year}-${String(fiscalStartMonth).padStart(2, '0')}-01`;
  return { from, to: addMonths(from, 11) };
}

/** Contrôle d'une période personnalisée ou d'un cumul ; renvoie le message d'erreur ou `null`. */
export function validatePeriod(p: Period): string | null {
  if (p.to < p.from) return 'Le mois de fin doit suivre le mois de début.';
  if (monthDiff(p.from, p.to) + 1 > MAX_PERIOD_MONTHS) return PERIOD_TOO_LONG;
  return null;
}

export const periodMonths = (p: Period): MonthKey[] => monthRange(p.from, monthDiff(p.from, p.to) + 1);

// ───────────────────────── Assistant prévisionnel ─────────────────────────

export interface HistoryAverage {
  categoryId: string;
  /** Moyenne mensuelle arrondie à l'euro. */
  average: number;
  /** Montant de chaque mois de l'historique. */
  monthly: { month: MonthKey; amount: number; excluded: boolean }[];
}

/**
 * Étape 1 « Partir de mon historique » : moyenne des `lookback` derniers mois
 * complets par catégorie feuille. « Exclure les mois exceptionnels » retire
 * les mois qui s'écartent de plus de 50 % de la médiane (au moins 3 mois requis).
 */
export function historyAverages(
  categories: Category[],
  transactions: Transaction[],
  currentMonth: MonthKey,
  lookback: 3 | 6 | 12,
  options: { excludeExceptional?: boolean } = {},
): HistoryAverage[] {
  const months = monthRange(addMonths(currentMonth, -lookback), lookback);
  const parents = new Set(categories.map((c) => c.parentId).filter(Boolean));
  const byId = new Map(categories.map((c) => [c.id, c]));
  const sums = new Map<string, Map<MonthKey, number>>();
  for (const t of transactions) {
    if (t.hidden || !t.categoryId || t.isSplit) continue;
    const m = monthOf(t.bookedAt);
    if (m < months[0]! || m >= currentMonth) continue;
    const cat = byId.get(t.categoryId);
    if (!cat || cat.isVat) continue;
    const row = sums.get(cat.id) ?? new Map<MonthKey, number>();
    row.set(m, (row.get(m) ?? 0) + (cat.flow === 'in' ? t.amount : -t.amount));
    sums.set(cat.id, row);
  }
  const out: HistoryAverage[] = [];
  for (const cat of categories) {
    if (parents.has(cat.id) || cat.isVat) continue;
    const row = sums.get(cat.id);
    if (!row) continue;
    const amounts = months.map((m) => Math.max(0, round2(row.get(m) ?? 0)));
    let excludedSet = new Set<number>();
    if (options.excludeExceptional && amounts.length >= 3) {
      const sorted = [...amounts].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      const median = sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
      if (median > 0) {
        excludedSet = new Set(amounts.flatMap((a, i) => (Math.abs(a - median) > median * 0.5 ? [i] : [])));
        if (excludedSet.size === amounts.length) excludedSet = new Set();
      }
    }
    const kept = amounts.filter((_, i) => !excludedSet.has(i));
    const average = Math.round(kept.reduce((s, a) => s + a, 0) / kept.length);
    if (average <= 0) continue;
    out.push({
      categoryId: cat.id,
      average,
      monthly: months.map((month, i) => ({ month, amount: amounts[i]!, excluded: excludedSet.has(i) })),
    });
  }
  return out;
}

export type ForecastEvent =
  | { type: 'hire'; label: string; month: MonthKey; grossMonthlySalary: number; employerChargesRate: number; salaryCategoryId: string; chargesCategoryId: string; endMonth?: MonthKey | null }
  | { type: 'investment'; label: string; month: MonthKey; amount: number; categoryId: string }
  | { type: 'loan'; label: string; month: MonthKey; amount: number; annualRate: number; durationMonths: number; inflowCategoryId: string; repaymentCategoryId: string }
  | { type: 'fundraising'; label: string; month: MonthKey; amount: number; categoryId: string };

/** Mensualité constante d'un emprunt (intérêts compris). */
export function loanInstallment(amount: number, annualRate: number, durationMonths: number): number {
  if (durationMonths < 1) throw new RangeError('La durée doit être d’au moins 1 mois.');
  const r = annualRate / 100 / 12;
  if (r === 0) return round2(amount / durationMonths);
  return round2((amount * r) / (1 - (1 + r) ** -durationMonths));
}

/** Montants (catégorie × mois) générés par un événement, limités aux mois `months`. */
export function eventAmounts(event: ForecastEvent, months: MonthKey[]): { categoryId: string; month: MonthKey; amount: number }[] {
  const inRange = new Set(months);
  const out: { categoryId: string; month: MonthKey; amount: number }[] = [];
  const add = (categoryId: string, month: MonthKey, amount: number) => {
    if (inRange.has(month) && amount > 0) out.push({ categoryId, month, amount: round2(amount) });
  };
  switch (event.type) {
    case 'hire':
      for (const m of months) {
        if (m < event.month || (event.endMonth && m > event.endMonth)) continue;
        add(event.salaryCategoryId, m, event.grossMonthlySalary);
        add(event.chargesCategoryId, m, (event.grossMonthlySalary * event.employerChargesRate) / 100);
      }
      break;
    case 'investment':
      add(event.categoryId, event.month, event.amount);
      break;
    case 'fundraising':
      add(event.categoryId, event.month, event.amount);
      break;
    case 'loan': {
      add(event.inflowCategoryId, event.month, event.amount);
      const installment = loanInstallment(event.amount, event.annualRate, event.durationMonths);
      for (let i = 1; i <= event.durationMonths; i++) add(event.repaymentCategoryId, addMonths(event.month, i), installment);
      break;
    }
  }
  return out;
}

export interface ForecastDraft {
  /** Moyennes retenues (catégorie → montant mensuel), modifiables dans l'aperçu. */
  baseline: Map<string, number>;
  growthIn: number;
  growthOut: number;
  events: ForecastEvent[];
}

/**
 * Budgets proposés par l'assistant pour les mois `months` : moyenne de
 * l'historique, majorée de la croissance selon le sens, plus les événements.
 */
export function buildForecast(draft: ForecastDraft, categories: Category[], months: MonthKey[], scenarioId: string): Budget[] {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const totals = new Map<string, number>();
  const key = (c: string, m: MonthKey) => `${c}|${m}`;
  for (const [categoryId, avg] of draft.baseline) {
    const cat = byId.get(categoryId);
    if (!cat || avg <= 0) continue;
    const growth = cat.flow === 'in' ? draft.growthIn : draft.growthOut;
    for (const m of months) totals.set(key(categoryId, m), Math.round(avg * (1 + growth / 100)));
  }
  for (const e of draft.events) {
    for (const a of eventAmounts(e, months)) {
      if (!byId.has(a.categoryId)) continue;
      totals.set(key(a.categoryId, a.month), round2((totals.get(key(a.categoryId, a.month)) ?? 0) + a.amount));
    }
  }
  return [...totals].map(([k, amount]) => {
    const [categoryId, month] = k.split('|') as [string, MonthKey];
    return { scenarioId, categoryId, month, amount };
  });
}

// ───────────────────────── Comparaison de scénarios ─────────────────────────

export interface ComparisonRow {
  month: MonthKey;
  /** Solde de fin de mois par scénario. */
  closing: Record<string, number>;
  /** Écart au scénario de base (scénario − base). */
  gap: Record<string, number>;
}

export function compareScenarios(plan: PlanResult, scenarioIds: string[]): ComparisonRow[] {
  const base = plan.scenarios[plan.baseScenarioId]!;
  return plan.months.map((month) => {
    const closing: Record<string, number> = {};
    const gap: Record<string, number> = {};
    for (const id of scenarioIds) {
      const sp = plan.scenarios[id];
      if (!sp) continue;
      closing[id] = sp.closing[month]!;
      gap[id] = round2(sp.closing[month]! - base.closing[month]!);
    }
    return { month, closing, gap };
  });
}

// ───────────────────────── TVA ─────────────────────────

/** Budgets de la catégorie TVA à partir d'un échéancier (5.8) : remplace les mois de la période. */
export function vatBudgets(
  scenarioId: string,
  vatCategoryId: string,
  months: MonthKey[],
  schedule: { month: MonthKey; due: number }[],
): Budget[] {
  const due = new Map(schedule.map((l) => [l.month, l.due]));
  return months.map((month) => ({ scenarioId, categoryId: vatCategoryId, month, amount: due.get(month) ? due.get(month)! : null }));
}
