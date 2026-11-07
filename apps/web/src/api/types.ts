import type { BankAccount, BankConnection, Budget, Category, Commitment, ForecastMode, Reconciliation, Rule, Scenario, Transaction } from '@optimum/treso-engine';
import type { IndicatorFormat } from '@optimum/treso-engine';

export type Role = 'OWNER' | 'ADMIN' | 'EDITOR' | 'ADVISOR' | 'VIEWER';

export interface MeCompany {
  id: string;
  name: string;
  plan: string;
  role: Role;
  roleLabel: string;
  isDemo: boolean;
}

export interface Me {
  id: string;
  email: string;
  firstName: string;
  lastName: string | null;
  theme: 'light' | 'dark' | 'system';
  activeCompanyId: string | null;
  companies: MeCompany[];
}

export interface CompanySettings {
  minCashThreshold: number;
  forecastMode: ForecastMode;
  invoicesEnabled: boolean;
  vatEnabled: boolean;
  vatRegime: 'monthly' | 'quarterly';
  overdueInPlan: 'current_month' | 'due_month';
  autoHideRefunds: boolean;
  autoHideInternalTransfers: boolean;
  fiscalYearStartMonth: number;
}

export interface Company {
  id: string;
  name: string;
  siren: string | null;
  sector: string | null;
  plan: string;
  trialEndsAt: string | null;
  isDemo: boolean;
  settings: CompanySettings;
}

export interface Bootstrap {
  company: Company;
  role: Role;
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

export interface Session {
  accessToken: string;
  expiresIn: number;
}

export interface Member {
  userId: string;
  email: string;
  name: string;
  role: Role;
  roleLabel: string;
  isMe: boolean;
}

export interface PendingInvitation {
  id: string;
  email: string;
  role: Role;
  roleLabel: string;
  expiresAt: string;
}

export const roleOptions: { value: Exclude<Role, 'OWNER'>; label: string; help: string }[] = [
  { value: 'ADMIN', label: 'Administrateur', help: 'Tout, y compris les utilisateurs et les paramètres.' },
  { value: 'EDITOR', label: 'Contributeur', help: 'Catégorise, saisit les budgets et les factures.' },
  { value: 'ADVISOR', label: 'Conseiller Optimum', help: 'Consulte tout et construit des scénarios alternatifs.' },
  { value: 'VIEWER', label: 'Lecteur', help: 'Consulte et exporte, sans rien modifier.' },
];

export const canWrite = (role: Role | null | undefined) => role === 'OWNER' || role === 'ADMIN' || role === 'EDITOR';
export const canAdmin = (role: Role | null | undefined) => role === 'OWNER' || role === 'ADMIN';
export const canEditScenarios = (role: Role | null | undefined) => canWrite(role) || role === 'ADVISOR';

export interface ImportEntry {
  id: string;
  type: 'transactions' | 'commitments' | 'budgets';
  fileName: string;
  rowsCount: number;
  createdAt: string;
  author: string | null;
}

/** Nom affiché d'un compte : nom personnalisé, sinon nom fourni par la banque. */
export const accountLabel = (a: Pick<BankAccount, 'name' | 'displayName'>) => a.displayName || a.name;

export interface Indicator {
  id: string;
  name: string;
  formula: string;
  unit: string;
  format: IndicatorFormat;
  decimals: number;
  position: number;
}

export interface BudgetNote {
  scenarioId: string;
  categoryId: string;
  month: string;
  note: string;
  updatedAt?: string;
}
