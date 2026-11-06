/** Types du domaine Tréso Optimum (cahier des charges, section 4). */

export type Flow = 'in' | 'out';

/** Mois de référence : toujours le 1er du mois, format `yyyy-MM-01`. */
export type MonthKey = string;

/** Date ISO `yyyy-MM-dd`. */
export type IsoDate = string;

export type CategoryKind = 'revenue' | 'purchases' | 'overheads' | 'payroll' | 'none';

export type ForecastMode = 'budget' | 'projection';

export interface Category {
  id: string;
  name: string;
  flow: Flow;
  parentId: string | null;
  position: number;
  kind: CategoryKind;
  vatRate: number;
  /** Budget saisi globalement au niveau de cette catégorie. */
  budgetAtParent: boolean;
  isVat?: boolean;
  isSystem?: boolean;
}

export interface Suggestion {
  categoryId: string;
  source: 'rule' | 'similar' | 'ai';
  confidence: 'high' | 'medium' | 'low';
}

export interface Transaction {
  id: string;
  accountId: string;
  bookedAt: IsoDate;
  rawLabel: string;
  label: string;
  counterparty?: string;
  /** Montant signé : encaissement positif, décaissement négatif. */
  amount: number;
  categoryId: string | null;
  suggestion?: Suggestion | null;
  hidden: boolean;
  note?: string;
}

export type CommitmentStatus = 'pending' | 'paid' | 'cancelled';

export interface Commitment {
  id: string;
  flow: Flow;
  counterparty: string;
  number?: string;
  label: string;
  /** Montant TTC positif. Le sens est porté par `flow`. */
  amountInclTax: number;
  /** Déjà réglé par des rapprochements confirmés (paiement partiel). */
  amountPaid?: number;
  vatRate: number;
  issuedAt: IsoDate;
  dueAt: IsoDate;
  status: CommitmentStatus;
  categoryId: string | null;
  hidden: boolean;
  accountId?: string | null;
  seriesId?: string | null;
}

export interface Scenario {
  id: string;
  name: string;
  color: string;
  isBase: boolean;
}

export interface Budget {
  scenarioId: string;
  categoryId: string;
  month: MonthKey;
  /** ≥ 0. `null` = hérite du scénario de base. */
  amount: number | null;
}

export interface BankAccount {
  id: string;
  name: string;
  bankName: string;
  balance: number;
  isActive: boolean;
}
