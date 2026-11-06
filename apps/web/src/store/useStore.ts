/**
 * État de la société active, chargé depuis l'API (`GET /bootstrap`).
 * Les modifications sont optimistes : l'écran change tout de suite, l'API
 * suit ; en cas d'échec, on affiche l'erreur et on recharge les données.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  findSimilar,
  repeatBudget,
  todayInParis,
  upsertBudgets,
  type BankAccount,
  type Budget,
  type Category,
  type Commitment,
  type ForecastMode,
  type MonthKey,
  type Rule,
  type Scenario,
  type Transaction,
} from '@optimum/treso-engine';
import type { Indicator } from '@optimum/demo-data';
import { api, ApiError } from '../api/client';
import { canAdmin, type Bootstrap, type Company, type CompanySettings, type Role } from '../api/types';

export type ThemePref = 'light' | 'dark' | 'system';

interface Data {
  accounts: BankAccount[];
  categories: Category[];
  transactions: Transaction[];
  commitments: Commitment[];
  scenarios: Scenario[];
  budgets: Budget[];
  rules: Rule[];
  indicators: Indicator[];
}

interface State extends Data {
  loaded: boolean;
  company: Company | null;
  companyName: string;
  role: Role | null;
  today: string;
  settings: CompanySettings;
  theme: ThemePref;
  undoSnapshot: Pick<Data, 'transactions' | 'commitments' | 'budgets'> | null;

  load: () => Promise<void>;
  clear: () => void;
  setTheme: (t: ThemePref) => void;
  setForecastMode: (m: ForecastMode) => void;
  updateSettings: (patch: Partial<CompanySettings> & { name?: string }) => Promise<void>;
  setBudget: (scenarioId: string, categoryId: string, month: MonthKey, amount: number | null) => void;
  repeatBudget: (scenarioId: string, categoryId: string, month: MonthKey, amount: number, every: number, duration: number) => void;
  addScenario: (name: string, color: string, copyFrom?: string) => Promise<string>;
  removeScenario: (id: string) => void;
  categorize: (ids: string[], categoryId: string) => Transaction[];
  setHidden: (ids: string[], hidden: boolean) => void;
  addRule: (rule: Omit<Rule, 'id'>) => void;
  confirmReconciliation: (transactionId: string, commitmentId: string) => void;
  undo: () => void;
}

const emptyData: Data = { accounts: [], categories: [], transactions: [], commitments: [], scenarios: [], budgets: [], rules: [], indicators: [] };
const defaultSettings: CompanySettings = {
  minCashThreshold: 0,
  forecastMode: 'projection',
  invoicesEnabled: true,
  vatEnabled: false,
  vatRegime: 'monthly',
  overdueInPlan: 'current_month',
};

/** Affichage des erreurs de synchronisation (branché par l'application sur les messages Ant Design). */
let notifyError: (message: string) => void = (m) => console.error(m);
export const setErrorNotifier = (fn: (message: string) => void) => {
  notifyError = fn;
};

export const useStore = create<State>()(
  persist(
    (set, get) => {
      /** Envoie une modification ; en cas d'échec, prévient et resynchronise. */
      const sync = (request: Promise<unknown>) => {
        request.catch((err: unknown) => {
          notifyError(err instanceof ApiError ? err.message : "La modification n'a pas pu être enregistrée.");
          void get().load();
        });
      };
      const snapshot = () => {
        const s = get();
        set({ undoSnapshot: { transactions: s.transactions, commitments: s.commitments, budgets: s.budgets } });
      };

      return {
        ...emptyData,
        loaded: false,
        company: null,
        companyName: '',
        role: null,
        today: todayInParis(),
        settings: defaultSettings,
        theme: 'system',
        undoSnapshot: null,

        load: async () => {
          const b = await api<Bootstrap>('GET', '/bootstrap');
          set({
            loaded: true,
            company: b.company,
            companyName: b.company.name,
            role: b.role,
            settings: b.company.settings,
            today: todayInParis(),
            accounts: b.accounts,
            categories: b.categories,
            transactions: b.transactions,
            commitments: b.commitments,
            scenarios: b.scenarios,
            budgets: b.budgets,
            rules: b.rules,
            indicators: b.indicators,
            undoSnapshot: null,
          });
        },

        clear: () => set({ ...emptyData, loaded: false, company: null, companyName: '', role: null, settings: defaultSettings, undoSnapshot: null }),

        setTheme: (theme) => {
          set({ theme });
          sync(api('PATCH', '/me', { theme }));
        },

        setForecastMode: (forecastMode) => {
          set((s) => ({ settings: { ...s.settings, forecastMode } }));
          // Réglage de la société : enregistré pour tous si l'on est administrateur, sinon affichage local
          if (canAdmin(get().role)) sync(api('PATCH', '/companies/current', { forecastMode }));
        },

        updateSettings: async (patch) => {
          const res = await api<Company>('PATCH', '/companies/current', patch);
          set({ company: res, companyName: res.name, settings: res.settings });
        },

        setBudget: (scenarioId, categoryId, month, amount) => {
          const s = get();
          const without = s.budgets.filter((b) => !(b.scenarioId === scenarioId && b.categoryId === categoryId && b.month === month));
          set({ budgets: amount === null ? without : upsertBudgets(without, [{ scenarioId, categoryId, month, amount }]) });
          sync(api('PUT', '/budgets', { changes: [{ scenarioId, categoryId, month, amount }] }));
        },

        repeatBudget: (scenarioId, categoryId, month, amount, every, duration) => {
          snapshot();
          const changes = repeatBudget(scenarioId, categoryId, month, amount, every, duration);
          set((s) => ({ budgets: upsertBudgets(s.budgets, changes) }));
          sync(api('PUT', '/budgets', { changes }));
        },

        addScenario: async (name, color, copyFrom) => {
          const created = await api<Scenario>('POST', '/scenarios', { name, color, copyFrom });
          set((s) => ({
            scenarios: [...s.scenarios, created],
            budgets: copyFrom
              ? [...s.budgets, ...s.budgets.filter((b) => b.scenarioId === copyFrom).map((b) => ({ ...b, scenarioId: created.id }))]
              : s.budgets,
          }));
          return created.id;
        },

        removeScenario: (id) => {
          set((s) => ({ scenarios: s.scenarios.filter((x) => x.id !== id || x.isBase), budgets: s.budgets.filter((b) => b.scenarioId !== id) }));
          sync(api('DELETE', `/scenarios/${encodeURIComponent(id)}`));
        },

        categorize: (ids, categoryId) => {
          snapshot();
          const idSet = new Set(ids);
          set((s) => ({ transactions: s.transactions.map((t) => (idSet.has(t.id) ? { ...t, categoryId, suggestion: null } : t)) }));
          sync(api('POST', '/transactions/batch', { ops: ids.map((id) => ({ id, categoryId })) }));
          const s = get();
          const first = s.transactions.find((t) => idSet.has(t.id));
          return first ? findSimilar(first, s.transactions).filter((t) => !idSet.has(t.id)) : [];
        },

        setHidden: (ids, hidden) => {
          snapshot();
          const idSet = new Set(ids);
          set((s) => ({ transactions: s.transactions.map((t) => (idSet.has(t.id) ? { ...t, hidden, suggestion: null } : t)) }));
          sync(api('POST', '/transactions/batch', { ops: ids.map((id) => ({ id, hidden })) }));
        },

        addRule: (rule) => {
          const temp = { ...rule, id: `tmp-${Date.now()}` };
          set((s) => ({ rules: [...s.rules, temp] }));
          sync(
            api<Rule>('POST', '/rules', rule).then((created) => set((s) => ({ rules: s.rules.map((r) => (r.id === temp.id ? created : r)) }))),
          );
        },

        confirmReconciliation: (transactionId, commitmentId) => {
          snapshot();
          set((s) => {
            const inv = s.commitments.find((c) => c.id === commitmentId);
            return {
              commitments: s.commitments.map((c) => (c.id === commitmentId ? { ...c, status: 'paid', amountPaid: c.amountInclTax } : c)),
              transactions: s.transactions.map((t) => (t.id === transactionId ? { ...t, categoryId: inv?.categoryId ?? t.categoryId, suggestion: null } : t)),
            };
          });
          sync(api('POST', '/reconciliations', { transactionId, commitmentId }));
        },

        /** Annule la dernière action réversible : restaure l'écran et envoie les opérations inverses. */
        undo: () => {
          const s = get();
          const snap = s.undoSnapshot;
          if (!snap) return;
          const before = new Map(snap.transactions.map((t) => [t.id, t]));
          const txOps = s.transactions
            .filter((t) => {
              const b = before.get(t.id);
              return b && (b.categoryId !== t.categoryId || b.hidden !== t.hidden);
            })
            .map((t) => {
              const b = before.get(t.id)!;
              return { id: t.id, categoryId: b.categoryId, hidden: b.hidden };
            });
          const commitmentOps = snap.commitments.filter((c) => {
            const now = s.commitments.find((x) => x.id === c.id);
            return now && (now.status !== c.status || now.amountPaid !== c.amountPaid);
          });
          const key = (b: Budget) => `${b.scenarioId}|${b.categoryId}|${b.month}`;
          const oldBudgets = new Map(snap.budgets.map((b) => [key(b), b]));
          const budgetOps: Budget[] = [];
          for (const b of s.budgets) {
            const old = oldBudgets.get(key(b));
            if (!old) budgetOps.push({ ...b, amount: null });
            else if (old.amount !== b.amount) budgetOps.push(old);
          }
          set({ ...snap, undoSnapshot: null });
          if (txOps.length) sync(api('POST', '/transactions/batch', { ops: txOps }));
          for (const c of commitmentOps) sync(api('PATCH', `/commitments/${encodeURIComponent(c.id)}`, { status: c.status, amountPaid: c.amountPaid ?? 0 }));
          if (budgetOps.length) sync(api('PUT', '/budgets', { changes: budgetOps }));
        },
      };
    },
    {
      name: 'treso-optimum-prefs',
      version: 2,
      // Seule la préférence de thème reste dans le navigateur ; les données viennent de l'API
      partialize: (s) => ({ theme: s.theme }),
    },
  ),
);
