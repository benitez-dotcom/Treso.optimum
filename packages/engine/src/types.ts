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
  /** Compte sur lequel les factures de cette catégorie sont attendues (5.12). */
  defaultAccountId?: string | null;
  /** Écran Catégories (7.9) : icône et couleur choisies dans une bibliothèque, note libre. */
  icon?: string | null;
  color?: string | null;
  note?: string | null;
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
  /** Date bancaire d'origine, quand la date d'imputation a été changée. */
  originalBookedAt?: IsoDate | null;
  /** Opération d'origine d'une ligne de division. */
  parentId?: string | null;
  /** Opération divisée : ses lignes remplacent son montant dans les catégories. */
  isSplit?: boolean;
  source?: TransactionSource;
  importId?: string | null;
  hiddenReason?: HiddenReason | null;
}

export type TransactionSource = 'bank' | 'manual' | 'import' | 'split';
export type HiddenReason = 'manual' | 'refund' | 'internal_transfer';

/** Compte dans les catégories (plan, analyses) : une opération divisée cède la place à ses lignes. */
export const countsInCategories = (t: Pick<Transaction, 'isSplit'>) => !t.isSplit;
/** Compte dans les soldes : les lignes de division ne doublent pas l'opération bancaire. */
export const countsInBalance = (t: Pick<Transaction, 'parentId'>) => !t.parentId;

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
  /** Rang dans la série (1 = première échéance). */
  seriesIndex?: number | null;
  paymentTerms?: PaymentTerms | null;
  vatAmount?: number | null;
  note?: string | null;
  source?: CommitmentSource;
  importId?: string | null;
  /** Échéance manuelle remplacée par une facture importée (doublon résolu). */
  replacedBy?: string | null;
  /** « Garder les deux » : ce doublon possible a été écarté. */
  notDuplicateOf?: string | null;
  paidAt?: IsoDate | null;
}

export type CommitmentSource = 'manual' | 'import' | 'ocr' | 'integration';
export type PaymentTerms = 'on_receipt' | 'd15' | 'd30' | 'd45' | 'd60' | 'end_of_month' | 'custom';

/** Rapprochement d'une opération bancaire et d'une facture (5.11). */
export interface Reconciliation {
  id: string;
  transactionId: string;
  commitmentId: string;
  /** Montant affecté à la facture (> 0). */
  amount: number;
}

export interface Scenario {
  id: string;
  name: string;
  color: string;
  isBase: boolean;
  description?: string | null;
  archived?: boolean;
}

export interface Budget {
  scenarioId: string;
  categoryId: string;
  month: MonthKey;
  /** ≥ 0. `null` = hérite du scénario de base. */
  amount: number | null;
}

export type AccountType = 'checking' | 'savings' | 'card' | 'loan' | 'cash' | 'other';
export type BalanceSource = 'balance' | 'booked' | 'instant';

export interface BankAccount {
  id: string;
  name: string;
  bankName: string;
  /** Solde retenu pour la trésorerie (selon `balanceSource`). */
  balance: number;
  isActive: boolean;
  connectionId?: string | null;
  displayName?: string | null;
  type?: AccountType;
  balances?: { balance: number | null; booked: number | null; instant: number | null };
  balanceSource?: BalanceSource;
  isManual?: boolean;
  openingBalance?: number | null;
  openingDate?: IsoDate | null;
  isDefaultForCommitments?: boolean;
  ignoreDeferredCard?: boolean;
  ibanMasked?: string | null;
  lastSyncAt?: string | null;
}

export interface BankConnection {
  id: string;
  provider: 'demo' | 'bridge';
  bankName: string;
  status: 'ok' | 'action_required' | 'error';
  statusDetail?: string | null;
  lastSyncAt?: string | null;
}
