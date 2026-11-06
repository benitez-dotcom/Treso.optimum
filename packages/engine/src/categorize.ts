/** Catégorisation assistée (règle 5.10). */
import type { Suggestion, Transaction } from './types';

export type RuleCondition =
  | { field: 'label'; op: 'contains' | 'startsWith'; value: string }
  | { field: 'amount'; op: 'between'; min: number; max: number }
  | { field: 'account'; op: 'is'; value: string };

export interface Rule {
  id: string;
  conditions: RuleCondition[];
  categoryId: string;
  autoApply: boolean;
  priority: number;
}

/** Libellé nettoyé : minuscules, sans accents, chiffres, dates ni références. */
export function normalizeLabel(label: string): string {
  return label
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\b(prlv|vir|cb|sepa|carte|paiement|recu|emis|inst)\b/g, ' ')
    .replace(/[0-9]+/g, ' ')
    .replace(/[^a-z ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function matches(rule: Rule, t: Transaction): boolean {
  return rule.conditions.every((c) => {
    if (c.field === 'label') {
      const hay = normalizeLabel(t.rawLabel);
      const needle = normalizeLabel(c.value);
      return c.op === 'contains' ? hay.includes(needle) : hay.startsWith(needle);
    }
    if (c.field === 'amount') return t.amount >= c.min && t.amount <= c.max;
    return t.accountId === c.value;
  });
}

const keyOf = (t: Transaction) => (t.counterparty ? `cp:${t.counterparty.toLowerCase()}` : `lb:${normalizeLabel(t.rawLabel)}`);

/**
 * Propose une catégorie : règle d'abord (par priorité décroissante), puis
 * similarité avec les opérations déjà catégorisées (même tiers ou même
 * libellé nettoyé ; confiance haute à partir de 3 occurrences identiques).
 */
export function suggestCategory(t: Transaction, rules: Rule[], history: Transaction[]): Suggestion | null {
  const sorted = [...rules].sort((a, b) => b.priority - a.priority);
  for (const r of sorted) {
    if (matches(r, t)) return { categoryId: r.categoryId, source: 'rule', confidence: 'high' };
  }
  const key = keyOf(t);
  const counts = new Map<string, number>();
  for (const h of history) {
    if (h.id === t.id || !h.categoryId || Math.sign(h.amount) !== Math.sign(t.amount)) continue;
    if (keyOf(h) !== key) continue;
    counts.set(h.categoryId, (counts.get(h.categoryId) ?? 0) + 1);
  }
  let best: [string, number] | null = null;
  for (const entry of counts) if (!best || entry[1] > best[1]) best = entry;
  if (!best) return null;
  return { categoryId: best[0], source: 'similar', confidence: best[1] >= 3 ? 'high' : 'medium' };
}

/** Opérations non catégorisées similaires à `t` (proposition « Appliquer aux similaires »). */
export function findSimilar(t: Transaction, all: Transaction[]): Transaction[] {
  const key = keyOf(t);
  return all.filter((o) => o.id !== t.id && !o.categoryId && Math.sign(o.amount) === Math.sign(t.amount) && keyOf(o) === key);
}

/** Applique les règles automatiques et les suggestions à une liste d'opérations. */
export function categorizeIncoming(incoming: Transaction[], rules: Rule[], history: Transaction[]): Transaction[] {
  return incoming.map((t) => {
    if (t.categoryId) return t;
    const auto = [...rules].sort((a, b) => b.priority - a.priority).find((r) => r.autoApply && matches(r, t));
    if (auto) return { ...t, categoryId: auto.categoryId, suggestion: null };
    return { ...t, suggestion: suggestCategory(t, rules, history) };
  });
}
