/**
 * Pré-comptabilité (écran 7.16) : plan comptable, correspondances catégorie
 * ↔ compte, écritures proposées depuis les factures et les opérations
 * bancaires, contrôle d'équilibre, fichier des écritures comptables (FEC).
 * Module pur.
 */
import { round2 } from './plan';
import { vatOf } from './vat';
import type { BankAccount, Category, Commitment, IsoDate, Reconciliation, Transaction } from './types';

export type LedgerType = 'client' | 'supplier' | 'bank' | 'expense' | 'revenue' | 'vat' | 'general';

export interface LedgerAccount {
  number: string;
  label: string;
  type: LedgerType;
  hidden?: boolean;
}

export const LEDGER_TYPE_LABELS: Record<LedgerType, string> = {
  client: 'Clients',
  supplier: 'Fournisseurs',
  bank: 'Banques',
  expense: 'Charges',
  revenue: 'Produits',
  vat: 'TVA',
  general: 'Général',
};

/** Plan comptable par défaut (extrait du PCG utile à une TPE). */
export const DEFAULT_CHART: LedgerAccount[] = [
  { number: '101300', label: 'Capital souscrit appelé versé', type: 'general' },
  { number: '164000', label: 'Emprunts auprès des établissements de crédit', type: 'general' },
  { number: '401000', label: 'Fournisseurs', type: 'supplier' },
  { number: '411000', label: 'Clients', type: 'client' },
  { number: '421000', label: 'Personnel - rémunérations dues', type: 'general' },
  { number: '431000', label: 'Sécurité sociale', type: 'general' },
  { number: '442100', label: 'Prélèvements à la source', type: 'general' },
  { number: '445510', label: 'TVA à décaisser', type: 'vat' },
  { number: '445660', label: 'TVA déductible sur autres biens et services', type: 'vat' },
  { number: '445670', label: 'Crédit de TVA à reporter', type: 'vat' },
  { number: '445711', label: 'TVA collectée 20 %', type: 'vat' },
  { number: '445712', label: 'TVA collectée 10 %', type: 'vat' },
  { number: '445713', label: 'TVA collectée 5,5 %', type: 'vat' },
  { number: '445714', label: 'TVA collectée 2,1 %', type: 'vat' },
  { number: '455000', label: 'Associés - comptes courants', type: 'general' },
  { number: '471000', label: 'Compte d’attente', type: 'general' },
  { number: '512000', label: 'Banque', type: 'bank' },
  { number: '530000', label: 'Caisse', type: 'bank' },
  { number: '604000', label: 'Achats d’études et prestations de services', type: 'expense' },
  { number: '606100', label: 'Fournitures non stockables (eau, énergie)', type: 'expense' },
  { number: '606400', label: 'Fournitures administratives', type: 'expense' },
  { number: '607000', label: 'Achats de marchandises', type: 'expense' },
  { number: '611000', label: 'Sous-traitance générale', type: 'expense' },
  { number: '613200', label: 'Locations immobilières', type: 'expense' },
  { number: '613500', label: 'Locations mobilières', type: 'expense' },
  { number: '615600', label: 'Maintenance', type: 'expense' },
  { number: '616000', label: 'Primes d’assurances', type: 'expense' },
  { number: '622600', label: 'Honoraires', type: 'expense' },
  { number: '623000', label: 'Publicité, publications, relations publiques', type: 'expense' },
  { number: '624100', label: 'Transports sur achats', type: 'expense' },
  { number: '625100', label: 'Voyages et déplacements', type: 'expense' },
  { number: '626200', label: 'Frais de télécommunications', type: 'expense' },
  { number: '627000', label: 'Services bancaires et assimilés', type: 'expense' },
  { number: '631000', label: 'Impôts, taxes et versements assimilés sur rémunérations', type: 'expense' },
  { number: '635000', label: 'Autres impôts, taxes et versements assimilés', type: 'expense' },
  { number: '641100', label: 'Salaires, appointements', type: 'expense' },
  { number: '645100', label: 'Cotisations à l’URSSAF', type: 'expense' },
  { number: '645200', label: 'Cotisations aux mutuelles', type: 'expense' },
  { number: '661100', label: 'Intérêts des emprunts et dettes', type: 'expense' },
  { number: '706000', label: 'Prestations de services', type: 'revenue' },
  { number: '707000', label: 'Ventes de marchandises', type: 'revenue' },
  { number: '708500', label: 'Ports et frais accessoires facturés', type: 'revenue' },
  { number: '758000', label: 'Produits divers de gestion courante', type: 'revenue' },
];

const norm = (s: string) => s.toLocaleLowerCase('fr').normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Mots-clés → compte, du plus précis au plus général. */
const KEYWORDS: [RegExp, string][] = [
  [/remboursement de tva|credit de tva/, '445670'],
  [/^tva$|tva a payer|tva a decaisser/, '445510'],
  [/loyer|bail/, '613200'],
  [/location de materiel|location/, '613500'],
  [/logiciel|abonnement|saas|licence/, '613500'],
  [/assurance/, '616000'],
  [/honoraire|expert|avocat|comptab/, '622600'],
  [/marketing|publicite|communication|salon/, '623000'],
  [/deplacement|voyage|carburant|vehicule/, '625100'],
  [/telecom|telephone|internet/, '626200'],
  [/frais bancaire|banque|commission/, '627000'],
  [/prelevement a la source/, '442100'],
  [/urssaf|cotisation|charges sociales/, '645100'],
  [/mutuelle|prevoyance/, '645200'],
  [/salaire|remuneration|paie/, '641100'],
  [/impot|taxe|cfe/, '635000'],
  [/emprunt|pret/, '164000'],
  [/energie|electricite|eau|gaz/, '606100'],
  [/fourniture/, '606400'],
  [/transport|livraison/, '624100'],
  [/sous-traitance|sous traitance/, '611000'],
  [/marchandise|materiaux|matieres|boisson/, '607000'],
  [/achat/, '607000'],
  [/apport|financement|capital/, '455000'],
  [/vente.*(magasin|en ligne)|ventes de marchandises/, '707000'],
  [/vente|prestation|chantier|honoraires percus|abonnements clients|acompte/, '706000'],
];

/** Compte comptable proposé pour une catégorie (correspondance automatique selon le nom puis la nature). */
export function suggestAccount(c: Pick<Category, 'name' | 'flow' | 'kind' | 'isVat'>): string {
  if (c.isVat) return '445510';
  const n = norm(c.name);
  for (const [re, acc] of KEYWORDS) if (re.test(n)) return acc;
  if (c.flow === 'in') return c.kind === 'revenue' ? '706000' : '758000';
  switch (c.kind) {
    case 'purchases':
      return '607000';
    case 'payroll':
      return '641100';
    case 'overheads':
      return '604000';
    default:
      return '471000';
  }
}

export interface VatAccounts {
  /** TVA déductible (achats), par taux. */
  deductible: Record<string, string>;
  /** TVA collectée (ventes), par taux. */
  collected: Record<string, string>;
}

export const DEFAULT_VAT_ACCOUNTS: VatAccounts = {
  deductible: { '20': '445660', '10': '445660', '5.5': '445660', '2.1': '445660' },
  collected: { '20': '445711', '10': '445712', '5.5': '445713', '2.1': '445714' },
};

export interface Journals {
  sales: string;
  purchases: string;
  /** Journal par compte bancaire (id du compte → code). */
  banks: Record<string, string>;
  /** Compte 512xxx par compte bancaire. */
  bankAccounts: Record<string, string>;
}

/** Journaux par défaut : VT, HA, puis BQ1, BQ2… et 512001, 512002… */
export function defaultJournals(accounts: Pick<BankAccount, 'id' | 'type'>[]): Journals {
  const banks: Record<string, string> = {};
  const bankAccounts: Record<string, string> = {};
  let i = 0;
  for (const a of accounts) {
    i++;
    banks[a.id] = a.type === 'cash' ? 'CA' : `BQ${i}`;
    bankAccounts[a.id] = a.type === 'cash' ? '530000' : `512${String(i).padStart(3, '0')}`;
  }
  return { sales: 'VT', purchases: 'HA', banks, bankAccounts };
}

export interface EntryLine {
  account: string;
  /** Compte auxiliaire (tiers) : facultatif. */
  auxAccount?: string | null;
  auxLabel?: string | null;
  label: string;
  debit: number;
  credit: number;
}

export type EntryStatus = 'draft' | 'validated' | 'sent' | 'rejected';
export type EntrySource = 'commitment' | 'transaction' | 'manual';

export interface Entry {
  id: string;
  sourceType: EntrySource;
  sourceId: string | null;
  journal: string;
  date: IsoDate;
  pieceRef: string;
  pieceDate: IsoDate;
  label: string;
  status: EntryStatus;
  /** Numéro séquentiel par journal, attribué à la validation. */
  number?: number | null;
  validatedAt?: IsoDate | null;
  rejectedReason?: string | null;
  lines: EntryLine[];
}

export interface PrecomptaContext {
  categories: Category[];
  /** Catégorie → compte (correspondances saisies) ; sinon proposition automatique. */
  mappings: Record<string, string>;
  vat: VatAccounts;
  journals: Journals;
  /** Compte utilisé sans correspondance. */
  suspense?: string;
}

const auxOf = (name: string, prefix: '401' | '411') =>
  `${prefix}${norm(name)
    .replace(/[^a-z0-9]/g, '')
    .toUpperCase()
    .slice(0, 8)}`;

export function accountOf(categoryId: string | null, ctx: PrecomptaContext): string {
  if (!categoryId) return ctx.suspense ?? '471000';
  if (ctx.mappings[categoryId]) return ctx.mappings[categoryId]!;
  const c = ctx.categories.find((x) => x.id === categoryId);
  return c ? suggestAccount(c) : (ctx.suspense ?? '471000');
}

const rateKey = (r: number) => String(r);
const vatAccount = (flow: 'in' | 'out', rate: number, ctx: PrecomptaContext) =>
  (flow === 'in' ? ctx.vat.collected : ctx.vat.deductible)[rateKey(rate)] ?? (flow === 'in' ? '445711' : '445660');

/** Écriture d'une facture : journal des ventes ou des achats, au tiers, HT et TVA. */
export function invoiceEntry(c: Commitment, ctx: PrecomptaContext): Omit<Entry, 'id' | 'status'> {
  const ttc = round2(c.amountInclTax);
  const vat = round2(c.vatAmount ?? vatOf(ttc, c.vatRate));
  const ht = round2(ttc - vat);
  const label = [c.counterparty, c.number].filter(Boolean).join(' · ').slice(0, 100);
  const ref = (c.number || c.id).slice(0, 40);
  const product = accountOf(c.categoryId, ctx);
  const lines: EntryLine[] =
    c.flow === 'in'
      ? [
          { account: '411000', auxAccount: auxOf(c.counterparty, '411'), auxLabel: c.counterparty, label, debit: ttc, credit: 0 },
          { account: product, label, debit: 0, credit: ht },
          ...(vat ? [{ account: vatAccount('in', c.vatRate, ctx), label, debit: 0, credit: vat }] : []),
        ]
      : [
          { account: product, label, debit: ht, credit: 0 },
          ...(vat ? [{ account: vatAccount('out', c.vatRate, ctx), label, debit: vat, credit: 0 }] : []),
          { account: '401000', auxAccount: auxOf(c.counterparty, '401'), auxLabel: c.counterparty, label, debit: 0, credit: ttc },
        ];
  return {
    sourceType: 'commitment',
    sourceId: c.id,
    journal: c.flow === 'in' ? ctx.journals.sales : ctx.journals.purchases,
    date: c.issuedAt,
    pieceRef: ref,
    pieceDate: c.issuedAt,
    label,
    lines,
  };
}

/**
 * Écriture d'une opération bancaire. Réglée par des factures : la banque
 * contre le tiers (401 / 411). Sinon : la banque contre la charge ou le
 * produit, TVA comprise selon le taux de la catégorie.
 */
export function transactionEntry(
  t: Transaction,
  ctx: PrecomptaContext,
  links: { commitment: Commitment; amount: number }[] = [],
): Omit<Entry, 'id' | 'status'> {
  const amount = round2(Math.abs(t.amount));
  const isIn = t.amount > 0;
  const bank = ctx.journals.bankAccounts[t.accountId] ?? '512000';
  const label = (t.counterparty || t.label).slice(0, 100);
  const lines: EntryLine[] = [];
  const bankLine: EntryLine = { account: bank, label, debit: isIn ? amount : 0, credit: isIn ? 0 : amount };
  lines.push(bankLine);
  let rest = amount;
  for (const l of links) {
    const a = round2(Math.min(l.amount, rest));
    if (a <= 0) continue;
    rest = round2(rest - a);
    const prefix = l.commitment.flow === 'in' ? '411' : '401';
    lines.push({
      account: `${prefix}000`,
      auxAccount: auxOf(l.commitment.counterparty, prefix),
      auxLabel: l.commitment.counterparty,
      label: [l.commitment.counterparty, l.commitment.number].filter(Boolean).join(' · ').slice(0, 100),
      debit: isIn ? 0 : a,
      credit: isIn ? a : 0,
    });
  }
  if (rest > 0) {
    const cat = t.categoryId ? ctx.categories.find((c) => c.id === t.categoryId) : undefined;
    const rate = cat && !cat.isVat ? cat.vatRate : 0;
    const vat = rate ? vatOf(rest, rate) : 0;
    const ht = round2(rest - vat);
    lines.push({ account: accountOf(t.categoryId, ctx), label, debit: isIn ? 0 : ht, credit: isIn ? ht : 0 });
    if (vat) lines.push({ account: vatAccount(isIn ? 'in' : 'out', rate, ctx), label, debit: isIn ? 0 : vat, credit: isIn ? vat : 0 });
  }
  return {
    sourceType: 'transaction',
    sourceId: t.id,
    journal: ctx.journals.banks[t.accountId] ?? 'BQ',
    date: t.bookedAt,
    pieceRef: t.id.slice(0, 40),
    pieceDate: t.bookedAt,
    label,
    lines,
  };
}

/** Factures rapprochées d'une opération, pour son écriture. */
export function linksOf(t: Transaction, reconciliations: Reconciliation[], commitments: Commitment[]) {
  const byId = new Map(commitments.map((c) => [c.id, c]));
  return reconciliations.filter((r) => r.transactionId === t.id && byId.has(r.commitmentId)).map((r) => ({ commitment: byId.get(r.commitmentId)!, amount: r.amount }));
}

const cents = (n: number) => Math.round(n * 100);
const eur = (n: number) => `${(Math.abs(n) / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

export interface EntryCheck {
  ok: boolean;
  debit: number;
  credit: number;
  errors: string[];
}

/** Contrôle d'une écriture avant validation : équilibre, comptes, montants. */
export function checkEntry(e: Pick<Entry, 'lines' | 'date' | 'journal' | 'pieceRef' | 'label'>, chart?: LedgerAccount[]): EntryCheck {
  const errors: string[] = [];
  const debit = e.lines.reduce((s, l) => s + cents(l.debit), 0);
  const credit = e.lines.reduce((s, l) => s + cents(l.credit), 0);
  if (e.lines.length < 2) errors.push('Une écriture compte au moins deux lignes.');
  e.lines.forEach((l, i) => {
    if (!/^\d{3,}[A-Z0-9]*$/.test(l.account)) errors.push(`Ligne ${i + 1} : compte invalide.`);
    else if (chart && !chart.some((a) => a.number === l.account)) errors.push(`Ligne ${i + 1} : le compte ${l.account} n’existe pas dans le plan de comptes.`);
    if (l.debit < 0 || l.credit < 0) errors.push(`Ligne ${i + 1} : montant négatif.`);
    if (l.debit > 0 && l.credit > 0) errors.push(`Ligne ${i + 1} : débit et crédit à la fois.`);
    if (!l.debit && !l.credit) errors.push(`Ligne ${i + 1} : montant manquant.`);
  });
  if (debit !== credit) errors.push(`Écart de ${eur(debit - credit)} entre débit et crédit`);
  if (!e.journal) errors.push('Journal manquant.');
  if (!e.date) errors.push('Date manquante.');
  if (!e.label.trim()) errors.push('Libellé manquant.');
  return { ok: errors.length === 0, debit: debit / 100, credit: credit / 100, errors };
}

// ───────────────────────── FEC (article A47 A-1 du LPF) ─────────────────────────

export const FEC_COLUMNS = [
  'JournalCode',
  'JournalLib',
  'EcritureNum',
  'EcritureDate',
  'CompteNum',
  'CompteLib',
  'CompAuxNum',
  'CompAuxLib',
  'PieceRef',
  'PieceDate',
  'EcritureLib',
  'Debit',
  'Credit',
  'EcritureLet',
  'DateLet',
  'ValidDate',
  'Montantdevise',
  'Idevise',
] as const;

const fecDate = (d: IsoDate) => d.replace(/-/g, '');
const fecAmount = (n: number) => n.toFixed(2).replace('.', ',');
const fecText = (s: string) => s.replace(/[|\t\r\n]/g, ' ').replace(/\s+/g, ' ').trim();

export interface FecInput {
  siren: string;
  /** Date de clôture de l'exercice (nom du fichier). */
  closingDate: IsoDate;
  from: IsoDate;
  to: IsoDate;
  entries: Entry[];
  chart: LedgerAccount[];
  journalLabels: Record<string, string>;
}

export interface FecResult {
  fileName: string;
  content: string;
  /** Contrôles de conformité ; le fichier n'est proposé que si `errors` est vide. */
  errors: string[];
  warnings: string[];
  entries: number;
  lines: number;
}

/** Construit le FEC (séparateur « | », 18 colonnes) et ses contrôles de conformité. */
export function buildFec(input: FecInput): FecResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!/^\d{9}$/.test(input.siren)) errors.push('SIREN manquant ou invalide : renseignez-le dans Paramètres › Société.');
  const chart = new Map(input.chart.map((a) => [a.number, a.label]));
  const entries = input.entries
    .filter((e) => (e.status === 'validated' || e.status === 'sent') && e.date >= input.from && e.date <= input.to)
    .sort((a, b) => a.journal.localeCompare(b.journal) || (a.number ?? 0) - (b.number ?? 0) || a.date.localeCompare(b.date));
  if (!entries.length) errors.push('Aucune écriture validée sur la période.');
  const rows: string[] = [FEC_COLUMNS.join('|')];
  const seq = new Map<string, number>();
  let lines = 0;
  for (const e of entries) {
    const check = checkEntry(e);
    if (!check.ok) errors.push(`Écriture ${e.journal} ${e.number ?? '?'} du ${e.date} : ${check.errors.join(' ; ')}`);
    if (!e.number) errors.push(`Écriture ${e.journal} du ${e.date} sans numéro.`);
    const expected = (seq.get(e.journal) ?? 0) + 1;
    if (e.number && e.number !== expected) warnings.push(`Journal ${e.journal} : numérotation discontinue (${expected} attendu, ${e.number} trouvé).`);
    if (e.number) seq.set(e.journal, e.number);
    if (!e.validatedAt) errors.push(`Écriture ${e.journal} ${e.number ?? '?'} : date de validation manquante.`);
    for (const l of e.lines) {
      lines++;
      if (!chart.has(l.account)) warnings.push(`Compte ${l.account} absent du plan de comptes : libellé par défaut.`);
      rows.push(
        [
          e.journal,
          fecText(input.journalLabels[e.journal] ?? e.journal),
          String(e.number ?? ''),
          fecDate(e.date),
          l.account,
          fecText(chart.get(l.account) ?? `Compte ${l.account}`),
          fecText(l.auxAccount ?? ''),
          fecText(l.auxLabel ?? ''),
          fecText(e.pieceRef),
          fecDate(e.pieceDate),
          fecText(l.label || e.label),
          fecAmount(l.debit),
          fecAmount(l.credit),
          '',
          '',
          e.validatedAt ? fecDate(e.validatedAt.slice(0, 10)) : '',
          '',
          '',
        ].join('|'),
      );
    }
  }
  return {
    fileName: `${input.siren}FEC${fecDate(input.closingDate)}.txt`,
    content: rows.join('\r\n') + '\r\n',
    errors: [...new Set(errors)],
    warnings: [...new Set(warnings)],
    entries: entries.length,
    lines,
  };
}

/** Écritures générables : factures et opérations sans écriture, dans la période. */
export function pendingSources(
  commitments: Commitment[],
  transactions: Transaction[],
  existing: Pick<Entry, 'sourceType' | 'sourceId'>[],
  from: IsoDate,
  to: IsoDate,
): { commitments: Commitment[]; transactions: Transaction[] } {
  const has = new Set(existing.map((e) => `${e.sourceType}|${e.sourceId}`));
  return {
    commitments: commitments.filter((c) => !c.replacedBy && c.status !== 'cancelled' && c.issuedAt >= from && c.issuedAt <= to && !has.has(`commitment|${c.id}`)),
    transactions: transactions.filter((t) => !t.isSplit && !t.hidden && t.bookedAt >= from && t.bookedAt <= to && !has.has(`transaction|${t.id}`)),
  };
}
