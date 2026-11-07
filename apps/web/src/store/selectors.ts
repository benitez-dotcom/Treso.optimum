import { useMemo } from 'react';
import {
  addMonths,
  computePlan,
  daysOverdue,
  monthOf,
  monthRange,
  openingBalanceAt,
  indicatorResolver,
  parseFormula,
  type Category,
  type Commitment,
  type Expr,
  type Flow,
  type MonthKey,
  type PlanResult,
  type Transaction,
} from '@optimum/treso-engine';
import { useStore } from './useStore';
import type { Indicator } from '../api/types';

export function useCurrentBalance(): number {
  const accounts = useStore((s) => s.accounts);
  return useMemo(() => accounts.filter((a) => a.isActive).reduce((sum, a) => sum + a.balance, 0), [accounts]);
}

export function useCurrentMonth(): MonthKey {
  const today = useStore((s) => s.today);
  return monthOf(today);
}

/**
 * Plan de trésorerie mémoïsé sur l'état du store. `accountIds` limite le plan
 * à certains comptes (opérations, solde et factures rattachées) ; `null` = tous
 * les comptes actifs.
 */
export function usePlan(from: MonthKey, count: number, accountIds: string[] | null = null): PlanResult {
  const s = useStore();
  return useMemo(() => {
    const months = monthRange(from, count);
    const selected = accountIds ? new Set(accountIds) : null;
    const accounts = s.accounts.filter((a) => (selected ? selected.has(a.id) : a.isActive));
    const accountSet = new Set(accounts.map((a) => a.id));
    const balance = accounts.reduce((sum, a) => sum + a.balance, 0);
    const transactions = selected ? s.transactions.filter((t) => accountSet.has(t.accountId)) : s.transactions;
    const commitments = selected ? s.commitments.filter((c) => !c.accountId || accountSet.has(c.accountId)) : s.commitments;
    return computePlan({
      categories: s.categories,
      transactions,
      commitments,
      budgets: s.budgets,
      scenarios: s.scenarios,
      months,
      today: s.today,
      mode: s.settings.forecastMode,
      openingBalance: openingBalanceAt(from, balance, transactions, s.today),
      invoicesEnabled: s.settings.invoicesEnabled,
      overdueInPlan: s.settings.overdueInPlan,
    });
  }, [s.categories, s.transactions, s.commitments, s.budgets, s.scenarios, s.accounts, s.today, s.settings, from, count, accountIds]);
}

export interface TreeRow {
  category: Category;
  depth: number;
  hasChildren: boolean;
}

/** Catégories d'un sens à plat, dans l'ordre de l'arbre. */
export function flattenTree(categories: Category[], flow: Flow): TreeRow[] {
  const byParent = new Map<string | null, Category[]>();
  for (const c of categories) {
    if (c.flow !== flow) continue;
    const list = byParent.get(c.parentId) ?? [];
    list.push(c);
    byParent.set(c.parentId, list);
  }
  const out: TreeRow[] = [];
  const walk = (parent: string | null, depth: number) => {
    const list = (byParent.get(parent) ?? []).sort((a, b) => a.position - b.position);
    for (const c of list) {
      const hasChildren = (byParent.get(c.id) ?? []).length > 0;
      out.push({ category: c, depth, hasChildren });
      walk(c.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

/** Options de sélection de catégorie (feuilles et parents), groupées par sens. */
export function useCategoryOptions(flow: Flow) {
  const categories = useStore((s) => s.categories);
  return useMemo(
    () =>
      flattenTree(categories, flow).map((r) => ({
        value: r.category.id,
        label: `${' '.repeat(r.depth)}${r.category.name}`,
        searchLabel: r.category.name,
      })),
    [categories, flow],
  );
}

export interface IndicatorExpr extends Indicator {
  expr: Expr | null;
  error: string | null;
}

export function useIndicatorExprs(): IndicatorExpr[] {
  const indicators = useStore((s) => s.indicators);
  const categories = useStore((s) => s.categories);
  return useMemo(() => {
    const resolve = indicatorResolver(categories);
    return [...indicators]
      .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name, 'fr'))
      .map((i) => {
        try {
          return { ...i, expr: parseFormula(i.formula, resolve), error: null };
        } catch (e) {
          return { ...i, expr: null, error: e instanceof Error ? e.message : 'Formule invalide.' };
        }
      });
  }, [indicators, categories]);
}

export type InboxItem =
  | { kind: 'group'; key: string; counterparty: string; transactions: Transaction[]; total: number; suggestedCategoryId: string | null; source: string | null; confidence: string | null }
  | { kind: 'reconciliation'; key: string; transaction: Transaction; commitment: Commitment }
  | { kind: 'overdue'; key: string; commitment: Commitment; days: number };

/** Flux « À traiter » (écran 7.3). */
export function useInbox(): InboxItem[] {
  const transactions = useStore((s) => s.transactions);
  const commitments = useStore((s) => s.commitments);
  const today = useStore((s) => s.today);
  return useMemo(() => {
    const items: InboxItem[] = [];
    const pending = commitments.filter((c) => c.status === 'pending');
    const usedTx = new Set<string>();

    for (const t of transactions) {
      if (t.categoryId || t.hidden || t.isSplit) continue;
      const match = pending.find(
        (c) => Math.abs(c.amountInclTax - Math.abs(t.amount)) < 0.01 && (c.flow === 'in') === t.amount > 0,
      );
      if (match) {
        items.push({ kind: 'reconciliation', key: `rec-${t.id}`, transaction: t, commitment: match });
        usedTx.add(t.id);
      }
    }

    const groups = new Map<string, Transaction[]>();
    for (const t of transactions) {
      if (t.categoryId || t.hidden || t.isSplit || usedTx.has(t.id)) continue;
      const key = `${t.counterparty ?? t.label}|${Math.sign(t.amount)}`;
      groups.set(key, [...(groups.get(key) ?? []), t]);
    }
    const groupItems: InboxItem[] = [...groups.entries()].map(([key, list]) => {
      list.sort((a, b) => b.bookedAt.localeCompare(a.bookedAt));
      const sug = list.find((t) => t.suggestion)?.suggestion ?? null;
      return {
        kind: 'group',
        key,
        counterparty: list[0]!.counterparty ?? list[0]!.label,
        transactions: list,
        total: list.reduce((s, t) => s + t.amount, 0),
        suggestedCategoryId: sug?.categoryId ?? null,
        source: sug?.source ?? null,
        confidence: sug?.confidence ?? null,
      };
    });
    groupItems.sort((a, b) =>
      a.kind === 'group' && b.kind === 'group' ? b.transactions[0]!.bookedAt.localeCompare(a.transactions[0]!.bookedAt) : 0,
    );
    items.push(...groupItems);

    for (const c of pending) {
      const days = daysOverdue(c, today);
      if (c.flow === 'in' && days > 0 && !items.some((i) => i.kind === 'reconciliation' && i.commitment.id === c.id)) {
        items.push({ kind: 'overdue', key: `od-${c.id}`, commitment: c, days });
      }
    }
    return items;
  }, [transactions, commitments, today]);
}

export const defaultPlanStart = (current: MonthKey) => addMonths(current, -2);
