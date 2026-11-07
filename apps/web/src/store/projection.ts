/** Projection au jour le jour et alertes, calculées sur l'état du store. */
import { useMemo } from 'react';
import {
  addDays,
  computeAlerts,
  dailyProjection,
  invoiceAccount,
  monthDiff,
  monthOf,
  uncoveredFromPlan,
  type Commitment,
  type DayPoint,
  type IsoDate,
} from '@optimum/treso-engine';
import { useStore } from './useStore';
import { usePlan } from './selectors';

export interface ProjectionOptions {
  from: IsoDate;
  to: IsoDate;
  /** `null` = comptes actifs. */
  accountIds: string[] | null;
  includeBudgets: boolean;
  shifts?: Map<string, IsoDate>;
}

/** Compte attendu de chaque facture (cascade 5.12), pour filtrer par compte. */
export function useInvoiceAccounts(): Map<string, string | null> {
  const commitments = useStore((s) => s.commitments);
  const categories = useStore((s) => s.categories);
  const accounts = useStore((s) => s.accounts);
  return useMemo(() => {
    const defaultAccountId = accounts.find((a) => a.isDefaultForCommitments)?.id ?? null;
    return new Map(commitments.map((c) => [c.id, invoiceAccount(c, { commitments, categories, defaultAccountId }).accountId]));
  }, [commitments, categories, accounts]);
}

export function useProjection(opts: ProjectionOptions): { points: DayPoint[]; commitments: Commitment[]; accountIds: string[] } {
  const s = useStore();
  const invoiceAccounts = useInvoiceAccounts();
  const planFrom = monthOf(opts.from);
  const plan = usePlan(planFrom, monthDiff(planFrom, monthOf(opts.to)) + 1, opts.accountIds);
  return useMemo(() => {
    const ids = opts.accountIds ?? s.accounts.filter((a) => a.isActive).map((a) => a.id);
    const set = new Set(ids);
    const balance = s.accounts.filter((a) => set.has(a.id)).reduce((sum, a) => sum + a.balance, 0);
    const transactions = s.transactions.filter((t) => set.has(t.accountId));
    // Une facture sans compte connu reste dans la vue « tous les comptes actifs »
    const commitments = s.commitments.filter((c) => {
      const acc = invoiceAccounts.get(c.id);
      return acc ? set.has(acc) : opts.accountIds === null;
    });
    const points = dailyProjection({
      from: opts.from,
      to: opts.to,
      today: s.today,
      currentBalance: balance,
      transactions,
      commitments,
      shifts: opts.shifts,
      uncovered: opts.includeBudgets ? uncoveredFromPlan(plan, plan.baseScenarioId) : undefined,
    });
    return { points, commitments, accountIds: ids };
  }, [s.accounts, s.transactions, s.commitments, s.today, invoiceAccounts, plan, opts.from, opts.to, opts.accountIds, opts.includeBudgets, opts.shifts]);
}

/** Alertes de trésorerie (5.13) pour la cloche : 60 jours, factures seules, comptes actifs. */
export function useAlerts() {
  const today = useStore((s) => s.today);
  const threshold = useStore((s) => s.settings.minCashThreshold);
  const commitments = useStore((s) => s.commitments);
  const categories = useStore((s) => s.categories);
  const connections = useStore((s) => s.connections);
  const { points } = useProjection({ from: today, to: addDays(today, 60), accountIds: null, includeBudgets: false });
  const current = monthOf(today);
  const plan = usePlan(current, 1);
  return useMemo(
    () => computeAlerts({ today, threshold, projection: points, commitments, categories, plan, connections }),
    [today, threshold, points, commitments, categories, plan, connections],
  );
}
