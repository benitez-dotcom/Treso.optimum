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
  type BankConnection,
  type Budget,
  type Category,
  type Commitment,
  type ForecastMode,
  type MonthKey,
  type PaymentTerms,
  type Reconciliation,
  type SeriesScope,
  type Rule,
  type Scenario,
  type Transaction,
} from '@optimum/treso-engine';
import { api, ApiError } from '../api/client';
import { canAdmin, type Bootstrap, type BudgetNote, type Company, type CompanySettings, type Indicator, type Role } from '../api/types';

export type ThemePref = 'light' | 'dark' | 'system';

interface Data {
  connections: BankConnection[];
  accounts: BankAccount[];
  categories: Category[];
  transactions: Transaction[];
  commitments: Commitment[];
  scenarios: Scenario[];
  budgets: Budget[];
  rules: Rule[];
  indicators: Indicator[];
  budgetNotes: BudgetNote[];
  reconciliations: Reconciliation[];
}

interface State extends Data {
  loaded: boolean;
  company: Company | null;
  companyName: string;
  role: Role | null;
  today: string;
  settings: CompanySettings;
  theme: ThemePref;
  undoSnapshot: (Pick<Data, 'transactions' | 'commitments' | 'budgets'> & { reconciliationIds?: string[] }) | null;

  load: () => Promise<void>;
  clear: () => void;
  setTheme: (t: ThemePref) => void;
  setForecastMode: (m: ForecastMode) => void;
  updateSettings: (patch: Partial<CompanySettings> & { name?: string }) => Promise<void>;
  setBudget: (scenarioId: string, categoryId: string, month: MonthKey, amount: number | null) => void;
  repeatBudget: (scenarioId: string, categoryId: string, month: MonthKey, amount: number, every: number, duration: number) => void;
  addScenario: (name: string, color: string, copyFrom?: string, description?: string) => Promise<string>;
  removeScenario: (id: string) => void;
  categorize: (ids: string[], categoryId: string) => Transaction[];
  setHidden: (ids: string[], hidden: boolean) => void;
  addRule: (rule: Omit<Rule, 'id'>) => void;
  confirmReconciliation: (transactionId: string, commitmentId: string) => void;
  undo: () => void;

  // ───── Lot 2 : opérations, banques, règles ─────
  acceptSuggestions: (ids: string[]) => void;
  setNote: (id: string, note: string | null) => void;
  setBookedAt: (id: string, bookedAt: string | null) => Promise<void>;
  createTransaction: (input: { accountId: string; bookedAt: string; label: string; amount: number; categoryId?: string | null; note?: string }) => Promise<Transaction>;
  deleteTransactions: (ids: string[]) => Promise<number>;
  splitTransaction: (id: string, lines: { amount: number; categoryId: string | null }[]) => Promise<void>;
  unsplitTransaction: (id: string) => Promise<void>;
  updateRule: (id: string, patch: Partial<Omit<Rule, 'id'>>) => Promise<void>;
  deleteRule: (id: string) => Promise<void>;
  reorderRules: (ids: string[]) => Promise<void>;
  applyRule: (id: string) => Promise<number>;
  createRule: (rule: Omit<Rule, 'id'>) => Promise<Rule>;

  // ───── Lot 3 : plan de trésorerie ─────
  /** Les 20 dernières saisies de budgets, pour « Annuler » (Ctrl/⌘ Z). */
  budgetHistory: Budget[][];
  budgetSave: 'idle' | 'saving' | 'saved' | 'error';
  applyBudgets: (changes: Budget[]) => void;
  undoBudgets: () => number;
  updateScenario: (id: string, patch: Partial<Pick<Scenario, 'name' | 'color' | 'description' | 'archived'>>) => Promise<void>;
  setBudgetNote: (scenarioId: string, categoryId: string, month: MonthKey, note: string | null) => Promise<void>;
  createIndicator: (input: Omit<Indicator, 'id' | 'position'>) => Promise<Indicator>;
  updateIndicator: (id: string, patch: Partial<Omit<Indicator, 'id' | 'position'>>) => Promise<void>;
  deleteIndicator: (id: string) => Promise<void>;
  reorderIndicators: (ids: string[]) => Promise<void>;

  // ───── Lot 4 : factures et rapprochements ─────
  createCommitments: (input: NewCommitment) => Promise<Commitment[]>;
  updateCommitment: (id: string, patch: CommitmentPatch, scope?: SeriesScope) => Promise<Commitment[]>;
  deleteCommitment: (id: string, scope?: SeriesScope) => Promise<number>;
  duplicateCommitment: (id: string) => Promise<Commitment>;
  reconcile: (transactionId: string, commitmentId: string, amount?: number) => Promise<void>;
  unreconcile: (reconciliationId: string) => Promise<void>;
  resolveDuplicate: (manualId: string, importedId: string, action: 'replace' | 'keep') => Promise<void>;
  setCategoryAccount: (categoryId: string, accountId: string | null) => Promise<void>;

  // ───── Catégories (7.9) ─────
  createCategory: (input: Partial<Category> & Pick<Category, 'name' | 'flow'>) => Promise<Category>;
  updateCategory: (id: string, patch: Partial<Pick<Category, 'name' | 'kind' | 'vatRate' | 'icon' | 'color' | 'note' | 'budgetAtParent' | 'defaultAccountId'>> & { applyAccountToOpenInvoices?: boolean }) => Promise<number>;
  moveCategory: (id: string, parentId: string | null, index: number, budgets?: 'sum' | 'delete') => Promise<void>;
  mergeCategory: (id: string, targetId: string) => Promise<void>;
  deleteCategory: (id: string, moveTo?: string) => Promise<void>;
  applyCategoryTemplate: (key: string) => Promise<number>;
}

export interface NewCommitment {
  flow: 'in' | 'out';
  counterparty: string;
  number?: string | null;
  label?: string;
  categoryId: string;
  amountInclTax: number;
  vatRate: number;
  vatAmount?: number | null;
  issuedAt: string;
  paymentTerms: PaymentTerms;
  dueAt: string;
  accountId?: string | null;
  note?: string | null;
  repeat?: { intervalMonths: number; count?: number | null; endDate?: string | null } | null;
}

export type CommitmentPatch = Partial<Omit<NewCommitment, 'flow' | 'repeat'>> & {
  hidden?: boolean;
  status?: Commitment['status'];
  amountPaid?: number;
  paidAt?: string | null;
};

const emptyData: Data = { connections: [], accounts: [], categories: [], transactions: [], commitments: [], scenarios: [], budgets: [], rules: [], indicators: [], budgetNotes: [], reconciliations: [] };
const defaultSettings: CompanySettings = {
  autoHideRefunds: true,
  autoHideInternalTransfers: true,
  minCashThreshold: 0,
  forecastMode: 'projection',
  invoicesEnabled: true,
  vatEnabled: false,
  vatRegime: 'monthly',
  overdueInPlan: 'current_month',
  fiscalYearStartMonth: 1,
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
      /** Enregistre des budgets par lots de 2 000 (limite de l'API), avec l'état « Enregistré ». */
      let inFlight = 0;
      const pushBudgets = (changes: Budget[]) => {
        inFlight++;
        set({ budgetSave: 'saving' });
        const chunks: Budget[][] = [];
        for (let i = 0; i < changes.length; i += 2000) chunks.push(changes.slice(i, i + 2000));
        Promise.all(chunks.map((c) => api('PUT', '/budgets', { changes: c })))
          .then(() => {
            inFlight--;
            if (inFlight === 0) set({ budgetSave: 'saved' });
          })
          .catch((err: unknown) => {
            inFlight--;
            set({ budgetSave: 'error' });
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
        budgetHistory: [],
        budgetSave: 'idle',

        load: async () => {
          const b = await api<Bootstrap>('GET', '/bootstrap');
          set({
            loaded: true,
            company: b.company,
            companyName: b.company.name,
            role: b.role,
            settings: b.company.settings,
            today: todayInParis(),
            connections: b.connections ?? [],
            accounts: b.accounts,
            categories: b.categories,
            transactions: b.transactions,
            commitments: b.commitments,
            scenarios: b.scenarios,
            budgets: b.budgets,
            rules: b.rules,
            indicators: b.indicators,
            budgetNotes: b.budgetNotes ?? [],
            reconciliations: b.reconciliations ?? [],
            undoSnapshot: null,
            budgetHistory: [],
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
          get().applyBudgets([{ scenarioId, categoryId, month, amount }]);
        },

        repeatBudget: (scenarioId, categoryId, month, amount, every, duration) => {
          get().applyBudgets(repeatBudget(scenarioId, categoryId, month, amount, every, duration));
        },

        applyBudgets: (changes) => {
          if (changes.length === 0) return;
          const s = get();
          const key = (b: Pick<Budget, 'scenarioId' | 'categoryId' | 'month'>) => `${b.scenarioId}|${b.categoryId}|${b.month}`;
          const current = new Map(s.budgets.map((b) => [key(b), b.amount]));
          // Dernière valeur par cellule, et valeurs précédentes pour l'annulation
          const unique = [...new Map(changes.map((c) => [key(c), c])).values()];
          const previous = unique.map((c) => ({ ...c, amount: current.get(key(c)) ?? null }));
          set({
            budgets: upsertBudgets(s.budgets, unique),
            budgetHistory: [...s.budgetHistory, previous].slice(-20),
          });
          pushBudgets(unique);
        },

        undoBudgets: () => {
          const s = get();
          const last = s.budgetHistory[s.budgetHistory.length - 1];
          if (!last) return 0;
          set({ budgets: upsertBudgets(s.budgets, last), budgetHistory: s.budgetHistory.slice(0, -1) });
          pushBudgets(last);
          return last.length;
        },

        updateScenario: async (id, patch) => {
          const before = get().scenarios;
          set({ scenarios: before.map((x) => (x.id === id ? { ...x, ...patch } : x)) });
          try {
            const updated = await api<Scenario>('PATCH', `/scenarios/${encodeURIComponent(id)}`, patch);
            set((s) => ({ scenarios: s.scenarios.map((x) => (x.id === id ? updated : x)) }));
          } catch (e) {
            set({ scenarios: before });
            throw e;
          }
        },

        setBudgetNote: async (scenarioId, categoryId, month, note) => {
          const text = note?.trim() || null;
          const others = get().budgetNotes.filter((n) => !(n.scenarioId === scenarioId && n.categoryId === categoryId && n.month === month));
          set({ budgetNotes: text ? [...others, { scenarioId, categoryId, month, note: text }] : others });
          sync(api('PUT', '/budget-notes', { scenarioId, categoryId, month, note: text }));
        },

        createIndicator: async (input) => {
          const created = await api<Indicator>('POST', '/indicators', input);
          set((s) => ({ indicators: [...s.indicators, created] }));
          return created;
        },

        updateIndicator: async (id, patch) => {
          const updated = await api<Indicator>('PATCH', `/indicators/${encodeURIComponent(id)}`, patch);
          set((s) => ({ indicators: s.indicators.map((i) => (i.id === id ? updated : i)) }));
        },

        deleteIndicator: async (id) => {
          await api('DELETE', `/indicators/${encodeURIComponent(id)}`);
          set((s) => ({ indicators: s.indicators.filter((i) => i.id !== id) }));
        },

        reorderIndicators: async (ids) => {
          const byId = new Map(get().indicators.map((i) => [i.id, i]));
          set({ indicators: ids.flatMap((id, i) => (byId.has(id) ? [{ ...byId.get(id)!, position: i + 1 }] : [])) });
          sync(api('PUT', '/indicators/order', { ids }));
        },

        addScenario: async (name, color, copyFrom, description) => {
          const created = await api<Scenario>('POST', '/scenarios', { name, color, copyFrom, description: description || undefined });
          set((s) => ({
            scenarios: [...s.scenarios, created],
            budgets: copyFrom
              ? [...s.budgets, ...s.budgets.filter((b) => b.scenarioId === copyFrom).map((b) => ({ ...b, scenarioId: created.id }))]
              : s.budgets,
          }));
          return created.id;
        },

        removeScenario: (id) => {
          set((s) => ({
            scenarios: s.scenarios.filter((x) => x.id !== id || x.isBase),
            budgets: s.budgets.filter((b) => b.scenarioId !== id),
            budgetNotes: s.budgetNotes.filter((n) => n.scenarioId !== id),
            budgetHistory: [],
          }));
          sync(api('DELETE', `/scenarios/${encodeURIComponent(id)}`));
        },

        categorize: (ids, categoryId) => {
          snapshot();
          const idSet = new Set(get().transactions.filter((t) => ids.includes(t.id) && !t.isSplit).map((t) => t.id));
          if (idSet.size === 0) return [];
          set((s) => ({ transactions: s.transactions.map((t) => (idSet.has(t.id) ? { ...t, categoryId, suggestion: null } : t)) }));
          sync(api('POST', '/transactions/batch', { ops: [...idSet].map((id) => ({ id, categoryId })) }));
          const s = get();
          const first = s.transactions.find((t) => idSet.has(t.id));
          return first ? findSimilar(first, s.transactions).filter((t) => !idSet.has(t.id)) : [];
        },

        setHidden: (ids, hidden) => {
          snapshot();
          const idSet = new Set(ids);
          set((s) => ({ transactions: s.transactions.map((t) => (idSet.has(t.id) ? { ...t, hidden, hiddenReason: hidden ? 'manual' : null, suggestion: null } : t)) }));
          sync(api('POST', '/transactions/batch', { ops: ids.map((id) => ({ id, hidden })) }));
        },

        acceptSuggestions: (ids) => {
          snapshot();
          const idSet = new Set(ids);
          const accepted = get().transactions.filter((t) => idSet.has(t.id) && t.suggestion && !t.isSplit);
          if (accepted.length === 0) return;
          const byId = new Map(accepted.map((t) => [t.id, t.suggestion!.categoryId]));
          set((s) => ({ transactions: s.transactions.map((t) => (byId.has(t.id) ? { ...t, categoryId: byId.get(t.id)!, suggestion: null } : t)) }));
          sync(api('POST', '/transactions/batch', { ops: accepted.map((t) => ({ id: t.id, acceptSuggestion: true })) }));
        },

        setNote: (id, note) => {
          set((s) => ({ transactions: s.transactions.map((t) => (t.id === id ? { ...t, note: note ?? undefined } : t)) }));
          sync(api('PATCH', `/transactions/${encodeURIComponent(id)}`, { note }));
        },

        setBookedAt: async (id, bookedAt) => {
          const updated = await api<Transaction>('PATCH', `/transactions/${encodeURIComponent(id)}`, bookedAt ? { bookedAt } : { resetBookedAt: true });
          set((s) => ({
            transactions: s.transactions.map((t) =>
              t.id === updated.id ? updated : t.parentId === id ? { ...t, bookedAt: updated.bookedAt, originalBookedAt: updated.originalBookedAt } : t,
            ),
          }));
        },

        createTransaction: async (input) => {
          const created = await api<Transaction>('POST', '/transactions', input);
          await get().load();
          return created;
        },

        deleteTransactions: async (ids) => {
          const res = await api<{ deleted: number }>('POST', '/transactions/delete', { ids });
          await get().load();
          return res.deleted;
        },

        splitTransaction: async (id, lines) => {
          const res = await api<{ transactions: Transaction[] }>('POST', `/transactions/${encodeURIComponent(id)}/split`, { lines });
          set((s) => ({ transactions: [...s.transactions.filter((t) => t.id !== id && t.parentId !== id), ...res.transactions] }));
        },

        unsplitTransaction: async (id) => {
          const parent = await api<Transaction>('DELETE', `/transactions/${encodeURIComponent(id)}/split`);
          set((s) => ({ transactions: [...s.transactions.filter((t) => t.id !== id && t.parentId !== id), parent] }));
        },

        createRule: async (rule) => {
          const created = await api<Rule>('POST', '/rules', rule);
          set((s) => ({ rules: [...s.rules, created].sort((a, b) => b.priority - a.priority) }));
          return created;
        },

        updateRule: async (id, patch) => {
          const updated = await api<Rule>('PATCH', `/rules/${encodeURIComponent(id)}`, patch);
          set((s) => ({ rules: s.rules.map((r) => (r.id === id ? updated : r)) }));
        },

        deleteRule: async (id) => {
          await api('DELETE', `/rules/${encodeURIComponent(id)}`);
          set((s) => ({ rules: s.rules.filter((r) => r.id !== id) }));
        },

        reorderRules: async (ids) => {
          const n = ids.length;
          set((s) => ({ rules: ids.map((id, i) => ({ ...s.rules.find((r) => r.id === id)!, priority: n - i })) }));
          await api('PUT', '/rules/order', { ids });
        },

        applyRule: async (id) => {
          const res = await api<{ updated: number }>('POST', `/rules/${encodeURIComponent(id)}/apply`, {});
          if (res.updated) await get().load();
          return res.updated;
        },

        addRule: (rule) => {
          const temp = { ...rule, id: `tmp-${Date.now()}` };
          set((s) => ({ rules: [...s.rules, temp] }));
          sync(
            api<Rule>('POST', '/rules', rule).then((created) => set((s) => ({ rules: s.rules.map((r) => (r.id === temp.id ? created : r)) }))),
          );
        },

        confirmReconciliation: (transactionId, commitmentId) => {
          void get()
            .reconcile(transactionId, commitmentId)
            .catch((err: unknown) => notifyError(err instanceof ApiError ? err.message : 'Le rapprochement a échoué.'));
        },

        reconcile: async (transactionId, commitmentId, amount) => {
          const s = get();
          const snap = { transactions: s.transactions, commitments: s.commitments, budgets: s.budgets };
          const res = await api<{ reconciliation: Reconciliation; commitment: Commitment; transactionCategoryId: string | null }>('POST', '/reconciliations', {
            transactionId,
            commitmentId,
            amount,
          });
          set((st) => ({
            reconciliations: [...st.reconciliations, res.reconciliation],
            commitments: st.commitments.map((c) => (c.id === commitmentId ? res.commitment : c)),
            transactions: st.transactions.map((t) => (t.id === transactionId ? { ...t, categoryId: res.transactionCategoryId, suggestion: null } : t)),
            undoSnapshot: { ...snap, reconciliationIds: [res.reconciliation.id] },
          }));
        },

        unreconcile: async (reconciliationId) => {
          const res = await api<{ commitment: Commitment }>('DELETE', `/reconciliations/${encodeURIComponent(reconciliationId)}`);
          set((st) => ({
            reconciliations: st.reconciliations.filter((r) => r.id !== reconciliationId),
            commitments: st.commitments.map((c) => (c.id === res.commitment.id ? res.commitment : c)),
          }));
        },

        createCommitments: async (input) => {
          const res = await api<{ commitments: Commitment[] }>('POST', '/commitments', input);
          set((st) => ({ commitments: [...st.commitments, ...res.commitments] }));
          return res.commitments;
        },

        updateCommitment: async (id, patch, scope = 'one') => {
          const res = await api<{ commitments: Commitment[] }>('PATCH', `/commitments/${encodeURIComponent(id)}`, { ...patch, scope });
          const byId = new Map(res.commitments.map((c) => [c.id, c]));
          set((st) => ({ commitments: st.commitments.map((c) => byId.get(c.id) ?? c) }));
          return res.commitments;
        },

        deleteCommitment: async (id, scope = 'one') => {
          const res = await api<{ deleted: string[] }>('DELETE', `/commitments/${encodeURIComponent(id)}?scope=${scope}`);
          const gone = new Set(res.deleted);
          set((st) => ({
            commitments: st.commitments.filter((c) => !gone.has(c.id)).map((c) => (c.replacedBy && gone.has(c.replacedBy) ? { ...c, replacedBy: null } : c)),
            reconciliations: st.reconciliations.filter((r) => !gone.has(r.commitmentId)),
          }));
          return res.deleted.length;
        },

        duplicateCommitment: async (id) => {
          const copy = await api<Commitment>('POST', `/commitments/${encodeURIComponent(id)}/duplicate`);
          set((st) => ({ commitments: [...st.commitments, copy] }));
          return copy;
        },

        resolveDuplicate: async (manualId, importedId, action) => {
          const res = await api<{ commitments: Commitment[] }>('POST', '/commitments/duplicates/resolve', { manualId, importedId, action });
          const byId = new Map(res.commitments.map((c) => [c.id, c]));
          set((st) => ({ commitments: st.commitments.map((c) => byId.get(c.id) ?? c) }));
        },

        createCategory: async (input) => {
          const created = await api<Category>('POST', '/categories', input);
          set((st) => ({ categories: [...st.categories, created] }));
          return created;
        },

        updateCategory: async (id, patch) => {
          const r = await api<Category & { invoicesUpdated: number }>('PATCH', `/categories/${encodeURIComponent(id)}`, patch);
          const { invoicesUpdated, ...cat } = r;
          set((st) => ({ categories: st.categories.map((c) => (c.id === id ? cat : c)) }));
          // Le compte reporté sur les factures se relit depuis le serveur
          if (invoicesUpdated) await get().load();
          return invoicesUpdated;
        },

        moveCategory: async (id, parentId, index, budgets) => {
          await api('POST', `/categories/${encodeURIComponent(id)}/move`, { parentId, index, budgets });
          await get().load();
        },

        mergeCategory: async (id, targetId) => {
          await api('POST', `/categories/${encodeURIComponent(id)}/merge`, { targetId });
          await get().load();
        },

        deleteCategory: async (id, moveTo) => {
          await api('DELETE', `/categories/${encodeURIComponent(id)}${moveTo ? `?moveTo=${encodeURIComponent(moveTo)}` : ''}`);
          await get().load();
        },

        applyCategoryTemplate: async (key) => {
          const r = await api<{ added: Category[] }>('POST', `/categories/templates/${encodeURIComponent(key)}`);
          set((st) => ({ categories: [...st.categories, ...r.added] }));
          return r.added.length;
        },

        setCategoryAccount: async (categoryId, accountId) => {
          await api('PATCH', `/categories/${encodeURIComponent(categoryId)}`, { defaultAccountId: accountId });
          set((st) => ({ categories: st.categories.map((c) => (c.id === categoryId ? { ...c, defaultAccountId: accountId } : c)) }));
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
          const recIds = snap.reconciliationIds ?? [];
          const commitmentOps = recIds.length ? [] : snap.commitments.filter((c) => {
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
          const { reconciliationIds: _r, ...restore } = snap;
          set({ ...restore, undoSnapshot: null, reconciliations: s.reconciliations.filter((r) => !recIds.includes(r.id)) });
          for (const id of recIds) sync(api('DELETE', `/reconciliations/${encodeURIComponent(id)}`));
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
