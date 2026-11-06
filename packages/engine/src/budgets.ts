/** Outils de saisie des budgets (règle 5.7 et assistant prévisionnel 7.4). */
import { addMonths, monthOf } from './dates';
import { round2 } from './plan';
import type { Budget, MonthKey, Transaction, Category } from './types';

/**
 * « Répéter tous les `every` mois pendant `duration` mois » à partir de `month` :
 * renvoie les mois M, M+every, M+2·every… jusqu'à M + duration − 1 inclus.
 */
export function repeatMonths(month: MonthKey, every: number, duration: number): MonthKey[] {
  if (every < 1 || every > 12) throw new RangeError('La répétition doit être comprise entre 1 et 12 mois.');
  if (duration < 1 || duration > 36) throw new RangeError('La durée doit être comprise entre 1 et 36 mois.');
  const out: MonthKey[] = [];
  for (let i = 0; i < duration; i += every) out.push(addMonths(month, i));
  return out;
}

export function repeatBudget(
  scenarioId: string,
  categoryId: string,
  month: MonthKey,
  amount: number,
  every: number,
  duration: number,
): Budget[] {
  return repeatMonths(month, every, duration).map((m) => ({ scenarioId, categoryId, month: m, amount }));
}

/** Remplace ou insère des budgets (unicité scénario × catégorie × mois). */
export function upsertBudgets(existing: Budget[], changes: Budget[]): Budget[] {
  const key = (b: Budget) => `${b.scenarioId}|${b.categoryId}|${b.month}`;
  const map = new Map(existing.map((b) => [key(b), b]));
  for (const c of changes) {
    if (c.amount !== null && c.amount < 0) throw new RangeError('Un budget ne peut pas être négatif.');
    map.set(key(c), c);
  }
  return [...map.values()].filter((b) => b.amount !== null);
}

/**
 * Assistant « Partir de mon historique » : moyenne mensuelle du réalisé
 * des `lookback` derniers mois complets, par catégorie feuille.
 */
export function averageFromHistory(
  categories: Category[],
  transactions: Transaction[],
  currentMonth: MonthKey,
  lookback: 3 | 6 | 12,
): Map<string, number> {
  const from = addMonths(currentMonth, -lookback);
  const byId = new Map(categories.map((c) => [c.id, c]));
  const sums = new Map<string, number>();
  for (const t of transactions) {
    if (t.hidden || !t.categoryId) continue;
    const m = monthOf(t.bookedAt);
    if (m < from || m >= currentMonth) continue;
    const cat = byId.get(t.categoryId);
    if (!cat) continue;
    const signed = cat.flow === 'in' ? t.amount : -t.amount;
    sums.set(cat.id, (sums.get(cat.id) ?? 0) + signed);
  }
  const out = new Map<string, number>();
  for (const [id, total] of sums) out.set(id, Math.max(0, Math.round(total / lookback)));
  return out;
}

/** Applique une croissance de `percent` % à une liste de budgets. */
export function applyGrowth(budgets: Budget[], percent: number): Budget[] {
  return budgets.map((b) => ({ ...b, amount: b.amount === null ? null : round2(b.amount * (1 + percent / 100)) }));
}
