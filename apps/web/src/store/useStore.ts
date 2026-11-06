import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  findSimilar,
  repeatBudget,
  todayInParis,
  upsertBudgets,
  type Budget,
  type ForecastMode,
  type MonthKey,
  type Rule,
  type Scenario,
  type Transaction,
} from '@optimum/treso-engine';
import { buildDemoData, type DemoData } from '../data/demo';

export type ThemePref = 'light' | 'dark' | 'system';

interface Settings {
  minCashThreshold: number;
  forecastMode: ForecastMode;
  invoicesEnabled: boolean;
}

interface State extends DemoData {
  today: string;
  settings: Settings;
  theme: ThemePref;
  /** Copie avant la dernière action réversible (toast « Annuler »). */
  undoSnapshot: Pick<DemoData, 'transactions' | 'commitments' | 'budgets' | 'rules'> | null;

  setTheme: (t: ThemePref) => void;
  setForecastMode: (m: ForecastMode) => void;
  setBudget: (scenarioId: string, categoryId: string, month: MonthKey, amount: number | null) => void;
  repeatBudget: (scenarioId: string, categoryId: string, month: MonthKey, amount: number, every: number, duration: number) => void;
  addScenario: (name: string, color: string, copyFrom?: string) => string;
  removeScenario: (id: string) => void;
  /** Catégorise des opérations ; renvoie les opérations similaires restant à catégoriser. */
  categorize: (ids: string[], categoryId: string) => Transaction[];
  setHidden: (ids: string[], hidden: boolean) => void;
  addRule: (rule: Omit<Rule, 'id'>) => void;
  confirmReconciliation: (transactionId: string, commitmentId: string) => void;
  undo: () => void;
  resetDemo: () => void;
}

const today = todayInParis();

export const useStore = create<State>()(
  persist(
    (set, get) => {
      const snapshot = () => {
        const s = get();
        set({ undoSnapshot: { transactions: s.transactions, commitments: s.commitments, budgets: s.budgets, rules: s.rules } });
      };
      return {
        ...buildDemoData(today),
        today,
        settings: { minCashThreshold: 35_000, forecastMode: 'projection', invoicesEnabled: true },
        theme: 'system',
        undoSnapshot: null,

        setTheme: (theme) => set({ theme }),
        setForecastMode: (forecastMode) => set((s) => ({ settings: { ...s.settings, forecastMode } })),

        setBudget: (scenarioId, categoryId, month, amount) => {
          const s = get();
          const without = s.budgets.filter((b) => !(b.scenarioId === scenarioId && b.categoryId === categoryId && b.month === month));
          const next: Budget[] = amount === null ? without : upsertBudgets(without, [{ scenarioId, categoryId, month, amount }]);
          set({ budgets: next });
        },

        repeatBudget: (scenarioId, categoryId, month, amount, every, duration) => {
          snapshot();
          set((s) => ({ budgets: upsertBudgets(s.budgets, repeatBudget(scenarioId, categoryId, month, amount, every, duration)) }));
        },

        addScenario: (name, color, copyFrom) => {
          const id = `sc-${Date.now().toString(36)}`;
          const scenario: Scenario = { id, name, color, isBase: false };
          set((s) => ({
            scenarios: [...s.scenarios, scenario],
            budgets: copyFrom
              ? [...s.budgets, ...s.budgets.filter((b) => b.scenarioId === copyFrom).map((b) => ({ ...b, scenarioId: id }))]
              : s.budgets,
          }));
          return id;
        },

        removeScenario: (id) =>
          set((s) => ({
            scenarios: s.scenarios.filter((x) => x.id !== id || x.isBase),
            budgets: s.budgets.filter((b) => b.scenarioId !== id),
          })),

        categorize: (ids, categoryId) => {
          snapshot();
          const idSet = new Set(ids);
          set((s) => ({
            transactions: s.transactions.map((t) => (idSet.has(t.id) ? { ...t, categoryId, suggestion: null } : t)),
          }));
          const s = get();
          const first = s.transactions.find((t) => idSet.has(t.id));
          return first ? findSimilar(first, s.transactions).filter((t) => !idSet.has(t.id)) : [];
        },

        setHidden: (ids, hidden) => {
          snapshot();
          const idSet = new Set(ids);
          set((s) => ({ transactions: s.transactions.map((t) => (idSet.has(t.id) ? { ...t, hidden, suggestion: null } : t)) }));
        },

        addRule: (rule) => set((s) => ({ rules: [...s.rules, { ...rule, id: `r-${Date.now().toString(36)}` }] })),

        confirmReconciliation: (transactionId, commitmentId) => {
          snapshot();
          set((s) => {
            const inv = s.commitments.find((c) => c.id === commitmentId);
            return {
              commitments: s.commitments.map((c) => (c.id === commitmentId ? { ...c, status: 'paid', amountPaid: c.amountInclTax } : c)),
              transactions: s.transactions.map((t) =>
                t.id === transactionId ? { ...t, categoryId: inv?.categoryId ?? t.categoryId, suggestion: null } : t,
              ),
            };
          });
        },

        undo: () => {
          const snap = get().undoSnapshot;
          if (snap) set({ ...snap, undoSnapshot: null });
        },

        resetDemo: () => set({ ...buildDemoData(todayInParis()), today: todayInParis(), undoSnapshot: null }),
      };
    },
    {
      name: 'treso-optimum-demo',
      version: 1,
      partialize: (s) => {
        const { undoSnapshot: _u, ...rest } = s;
        return rest;
      },
      // Données de démonstration : on régénère si elles datent d'un autre jour
      onRehydrateStorage: () => (state) => {
        if (state && state.today !== todayInParis()) state.resetDemo();
      },
    },
  ),
);
