/**
 * Factures clients et fournisseurs (écran 7.8, règles 5.11 et 5.12) :
 * délais de paiement, séries récurrentes, statuts, compte en cascade,
 * rapprochements, doublons, import et relances. Module pur.
 */
import { parseAmount, parseDate } from './bank';
import { normalizeLabel } from './categorize';
import { addDays, daysBetween } from './dates';
import { round2 } from './plan';
import type { Category, Commitment, IsoDate, PaymentTerms, Reconciliation, Transaction } from './types';

// ───────────────────────── Délais et échéances ─────────────────────────

export const PAYMENT_TERMS: { value: PaymentTerms; label: string }[] = [
  { value: 'on_receipt', label: 'À réception' },
  { value: 'd15', label: '15 jours' },
  { value: 'd30', label: '30 jours' },
  { value: 'd45', label: '45 jours' },
  { value: 'd60', label: '60 jours' },
  { value: 'end_of_month', label: 'Fin de mois' },
  { value: 'custom', label: 'Personnalisé' },
];

const lastDayOfMonth = (d: IsoDate): IsoDate => {
  const y = Number(d.slice(0, 4));
  const m = Number(d.slice(5, 7));
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${d.slice(0, 8)}${String(last).padStart(2, '0')}`;
};

/** Échéance calculée depuis la date d'émission et le délai ; `null` pour un délai personnalisé. */
export function dueFromTerms(issuedAt: IsoDate, terms: PaymentTerms): IsoDate | null {
  switch (terms) {
    case 'on_receipt':
      return issuedAt;
    case 'd15':
      return addDays(issuedAt, 15);
    case 'd30':
      return addDays(issuedAt, 30);
    case 'd45':
      return addDays(issuedAt, 45);
    case 'd60':
      return addDays(issuedAt, 60);
    case 'end_of_month':
      return lastDayOfMonth(issuedAt);
    default:
      return null;
  }
}

/** Délai correspondant à une échéance saisie à la main (« personnalisé » s'il n'y en a pas). */
export function termsFromDates(issuedAt: IsoDate, dueAt: IsoDate): PaymentTerms {
  const hit = PAYMENT_TERMS.find((t) => t.value !== 'custom' && dueFromTerms(issuedAt, t.value) === dueAt);
  return hit ? hit.value : 'custom';
}

/** Ajoute `n` mois à une date en gardant le jour, ramené au dernier jour du mois si besoin (31 janv. + 1 → 28/29 févr.). */
export function addMonthsToDate(date: IsoDate, n: number): IsoDate {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7)) - 1 + n;
  const d = Number(date.slice(8, 10));
  const year = y + Math.floor(m / 12);
  const month = ((m % 12) + 12) % 12;
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

// ───────────────────────── Séries récurrentes ─────────────────────────

export type Frequency = 'monthly' | 'bimonthly' | 'quarterly' | 'semiannual' | 'yearly' | 'custom';

export const FREQUENCIES: { value: Frequency; label: string; months: number }[] = [
  { value: 'monthly', label: 'Chaque mois', months: 1 },
  { value: 'bimonthly', label: 'Tous les 2 mois', months: 2 },
  { value: 'quarterly', label: 'Chaque trimestre', months: 3 },
  { value: 'semiannual', label: 'Chaque semestre', months: 6 },
  { value: 'yearly', label: 'Chaque année', months: 12 },
  { value: 'custom', label: 'Personnalisée', months: 0 },
];

export const MAX_OCCURRENCES = 120;

/**
 * Dates d'une série : la première échéance puis tous les `intervalMonths`
 * mois, jusqu'à `count` échéances (1–120) ou jusqu'à `endDate` incluse.
 * Chaque date est calculée depuis la première (pas de dérive en fin de mois).
 */
export function seriesDates(first: IsoDate, intervalMonths: number, limit: { count?: number | null; endDate?: IsoDate | null }): IsoDate[] {
  if (intervalMonths < 1 || intervalMonths > 24) throw new RangeError('La fréquence doit être comprise entre 1 et 24 mois.');
  const max = limit.count ?? MAX_OCCURRENCES;
  if (max < 1 || max > MAX_OCCURRENCES) throw new RangeError('Le nombre d’échéances doit être compris entre 1 et 120.');
  const out: IsoDate[] = [];
  for (let i = 0; i < max; i++) {
    const d = addMonthsToDate(first, i * intervalMonths);
    if (limit.endDate && d > limit.endDate) break;
    out.push(d);
  }
  return out;
}

export type SeriesScope = 'one' | 'following';

/** Une échéance qu'on ne modifie jamais en « et les suivantes » : passée, payée (même en partie) ou remplacée. */
export const isLockedOccurrence = (c: Commitment, today: IsoDate) =>
  c.status !== 'pending' || (c.amountPaid ?? 0) > 0 || !!c.replacedBy || c.dueAt < today;

/**
 * Échéances touchées par une modification ou une suppression (7.8) :
 * « Cette échéance seulement » ou « Cette échéance et les suivantes ».
 */
export function seriesTargets(all: Commitment[], target: Commitment, scope: SeriesScope, today: IsoDate): Commitment[] {
  if (scope === 'one' || !target.seriesId) return [target];
  return all
    .filter((c) => c.seriesId === target.seriesId && (c.id === target.id || (c.dueAt > target.dueAt && !isLockedOccurrence(c, today))))
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt));
}

// ───────────────────────── Statut ─────────────────────────

export type InvoiceStatus = 'upcoming' | 'overdue' | 'partial' | 'paid' | 'cancelled';

export const remainingOf = (c: Pick<Commitment, 'amountInclTax' | 'amountPaid'>) => round2(Math.max(0, c.amountInclTax - (c.amountPaid ?? 0)));

export function invoiceStatus(c: Commitment, today: IsoDate): { status: InvoiceStatus; daysLate: number } {
  if (c.status === 'cancelled') return { status: 'cancelled', daysLate: 0 };
  if (c.status === 'paid' || remainingOf(c) === 0) return { status: 'paid', daysLate: 0 };
  const daysLate = c.dueAt < today ? daysBetween(c.dueAt, today) : 0;
  if (daysLate > 0) return { status: 'overdue', daysLate };
  return { status: (c.amountPaid ?? 0) > 0 ? 'partial' : 'upcoming', daysLate: 0 };
}

export const STATUS_LABELS: Record<InvoiceStatus, string> = {
  upcoming: 'À venir',
  overdue: 'En retard',
  partial: 'Partiellement payée',
  paid: 'Payée',
  cancelled: 'Annulée',
};

/** Factures qui comptent dans la trésorerie : non payées, non annulées, non remplacées. */
export const isOpen = (c: Commitment) => c.status === 'pending' && !c.replacedBy && remainingOf(c) > 0;

// ───────────────────────── Compte en cascade (5.12) ─────────────────────────

export type AccountSource = 'invoice' | 'counterparty' | 'category' | 'parent' | 'default' | 'none';

/**
 * Compte où le paiement est attendu : compte de la facture → compte des
 * factures du même tiers → compte par défaut de la catégorie → du parent →
 * compte par défaut des engagements.
 */
export function invoiceAccount(
  c: Pick<Commitment, 'id' | 'accountId' | 'counterparty' | 'categoryId'>,
  ctx: { commitments: Commitment[]; categories: Category[]; defaultAccountId: string | null },
): { accountId: string | null; source: AccountSource } {
  if (c.accountId) return { accountId: c.accountId, source: 'invoice' };
  const key = normalizeLabel(c.counterparty);
  const sibling = ctx.commitments
    .filter((o) => o.id !== c.id && o.accountId && normalizeLabel(o.counterparty) === key)
    .sort((a, b) => b.issuedAt.localeCompare(a.issuedAt))[0];
  if (sibling) return { accountId: sibling.accountId!, source: 'counterparty' };
  const cat = c.categoryId ? ctx.categories.find((k) => k.id === c.categoryId) : undefined;
  if (cat?.defaultAccountId) return { accountId: cat.defaultAccountId, source: 'category' };
  let parent = cat?.parentId ? ctx.categories.find((k) => k.id === cat.parentId) : undefined;
  while (parent) {
    if (parent.defaultAccountId) return { accountId: parent.defaultAccountId, source: 'parent' };
    parent = parent.parentId ? ctx.categories.find((k) => k.id === parent!.parentId) : undefined;
  }
  if (ctx.defaultAccountId) return { accountId: ctx.defaultAccountId, source: 'default' };
  return { accountId: null, source: 'none' };
}

// ───────────────────────── Tiers connus ─────────────────────────

export interface CounterpartyDefaults {
  name: string;
  categoryId: string | null;
  vatRate: number;
  paymentTerms: PaymentTerms;
  accountId: string | null;
  count: number;
}

/** Habitudes de chaque tiers (dernière facture) : pré-remplit le formulaire. */
export function counterpartyDefaults(commitments: Commitment[], flow: Commitment['flow']): CounterpartyDefaults[] {
  const byKey = new Map<string, CounterpartyDefaults & { last: IsoDate }>();
  for (const c of commitments) {
    if (c.flow !== flow) continue;
    const key = normalizeLabel(c.counterparty);
    const prev = byKey.get(key);
    const entry = {
      name: c.counterparty,
      categoryId: c.categoryId,
      vatRate: c.vatRate,
      paymentTerms: c.paymentTerms ?? termsFromDates(c.issuedAt, c.dueAt),
      accountId: c.accountId ?? null,
      count: (prev?.count ?? 0) + 1,
      last: c.issuedAt,
    };
    if (!prev || c.issuedAt >= prev.last) byKey.set(key, entry);
    else prev.count++;
  }
  return [...byKey.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'fr')).map(({ last: _last, ...d }) => d);
}

// ───────────────────────── Rapprochements (5.11) ─────────────────────────

export const RECONCILIATION_EXCEEDED = 'Le total des factures dépasse le montant de ce paiement.';

/** Montant d'une opération déjà affecté à des factures. */
export function allocatedOf(transactionId: string, reconciliations: Reconciliation[]): number {
  return round2(reconciliations.filter((r) => r.transactionId === transactionId).reduce((s, r) => s + r.amount, 0));
}

/**
 * Contrôle d'un nouveau rapprochement : même sens, montant positif, total
 * affecté à l'opération ≤ son montant, et pas plus que le reste à payer.
 */
export function checkReconciliation(
  t: Pick<Transaction, 'id' | 'amount'>,
  c: Commitment,
  amount: number,
  reconciliations: Reconciliation[],
): string | null {
  if ((t.amount > 0) !== (c.flow === 'in')) return 'Le paiement et la facture ne vont pas dans le même sens.';
  if (!(amount > 0)) return 'Indiquez un montant positif.';
  if (round2(allocatedOf(t.id, reconciliations) + amount) > round2(Math.abs(t.amount)) + 0.001) return RECONCILIATION_EXCEEDED;
  if (amount > remainingOf(c) + 0.001) return 'Ce montant dépasse le reste à payer de la facture.';
  return null;
}

export interface MatchCandidate {
  transaction: Transaction;
  commitment: Commitment;
  score: number;
  reasons: string[];
  /** Montant proposé : le plus petit entre le disponible de l'opération et le reste à payer. */
  amount: number;
}

/** Référence comparable : minuscules, chiffres et lettres seulement (« FA-2026/112 » → « fa2026112 »). */
const alnum = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/[^a-z0-9]/g, '');

const tokens = (s: string) => normalizeLabel(s).split(' ').filter((w) => w.length >= 3);

/**
 * Score d'un couple opération ↔ facture (0–100) : montant identique au reste
 * à payer (± 0,01 €), numéro ou tiers dans le libellé, date proche de l'échéance.
 */
export function matchScore(t: Transaction, c: Commitment, available: number): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;
  const remaining = remainingOf(c);
  if (Math.abs(available - remaining) <= 0.01) {
    score += 60;
    reasons.push('Montant identique');
  } else if (Math.abs(Math.abs(t.amount) - c.amountInclTax) <= 0.01) {
    score += 50;
    reasons.push('Montant TTC identique');
  }
  const label = normalizeLabel(`${t.rawLabel} ${t.label} ${t.counterparty ?? ''}`);
  const num = c.number ? alnum(c.number) : '';
  if (num.length >= 3 && alnum(`${t.rawLabel} ${t.label}`).includes(num)) {
    score += 30;
    reasons.push(`Numéro ${c.number}`);
  }
  const words = tokens(c.counterparty);
  if (words.length && words.some((w) => label.includes(w))) {
    score += 20;
    reasons.push('Même tiers');
  }
  const gap = Math.abs(daysBetween(c.dueAt, t.bookedAt));
  if (gap <= 10) {
    score += 10;
    reasons.push('Date proche de l’échéance');
  }
  return { score: Math.min(100, score), reasons };
}

/**
 * Suggestions de rapprochement : opérations non entièrement rapprochées, de même
 * sens, avec un montant égal ou un libellé citant le numéro ou le tiers.
 * Triées par score décroissant.
 */
export function reconciliationCandidates(
  transactions: Transaction[],
  commitments: Commitment[],
  reconciliations: Reconciliation[],
  options: { commitmentId?: string; transactionId?: string; minScore?: number } = {},
): MatchCandidate[] {
  const minScore = options.minScore ?? 20;
  const open = commitments.filter((c) => isOpen(c) && (!options.commitmentId || c.id === options.commitmentId));
  const out: MatchCandidate[] = [];
  for (const t of transactions) {
    if (t.isSplit || t.hidden || (options.transactionId && t.id !== options.transactionId)) continue;
    const available = round2(Math.abs(t.amount) - allocatedOf(t.id, reconciliations));
    if (available <= 0.005) continue;
    for (const c of open) {
      if ((t.amount > 0) !== (c.flow === 'in')) continue;
      if (t.bookedAt < addDays(c.issuedAt, -30)) continue;
      const { score, reasons } = matchScore(t, c, available);
      // Il faut au moins un indice fort : montant, numéro ou tiers (la date seule ne suffit pas)
      if (score < minScore || reasons.every((r) => r.startsWith('Date'))) continue;
      out.push({ transaction: t, commitment: c, score, reasons, amount: round2(Math.min(available, remainingOf(c))) });
    }
  }
  return out.sort((a, b) => b.score - a.score || a.commitment.dueAt.localeCompare(b.commitment.dueAt));
}

/** Meilleure suggestion par facture et par opération (chacune n'apparaît qu'une fois). */
export function bestMatches(candidates: MatchCandidate[]): MatchCandidate[] {
  const usedT = new Set<string>();
  const usedC = new Set<string>();
  const out: MatchCandidate[] = [];
  for (const m of candidates) {
    if (usedT.has(m.transaction.id) || usedC.has(m.commitment.id)) continue;
    usedT.add(m.transaction.id);
    usedC.add(m.commitment.id);
    out.push(m);
  }
  return out;
}

// ───────────────────────── Doublons ─────────────────────────

export interface DuplicatePair {
  /** Échéance saisie à la main (souvent récurrente). */
  manual: Commitment;
  /** Facture importée, déposée ou synchronisée. */
  imported: Commitment;
}

/**
 * Doublons possibles : une échéance manuelle et une facture importée du même
 * sens et du même tiers, montant à 2 % près, échéances à 10 jours près.
 */
export function findDuplicates(commitments: Commitment[]): DuplicatePair[] {
  const open = commitments.filter((c) => c.status === 'pending' && !c.replacedBy);
  const manual = open.filter((c) => (c.source ?? 'manual') === 'manual');
  const imported = open.filter((c) => c.source && c.source !== 'manual');
  const pairs: DuplicatePair[] = [];
  const used = new Set<string>();
  for (const m of manual) {
    const key = normalizeLabel(m.counterparty);
    const hit = imported.find(
      (i) =>
        !used.has(i.id) &&
        m.notDuplicateOf !== i.id &&
        i.flow === m.flow &&
        normalizeLabel(i.counterparty) === key &&
        Math.abs(i.amountInclTax - m.amountInclTax) <= Math.max(1, m.amountInclTax * 0.02) &&
        Math.abs(daysBetween(i.dueAt, m.dueAt)) <= 10,
    );
    if (hit) {
      used.add(hit.id);
      pairs.push({ manual: m, imported: hit });
    }
  }
  return pairs;
}

// ───────────────────────── Import de factures ─────────────────────────

export type InvoiceImportField = 'counterparty' | 'number' | 'label' | 'amount' | 'vatRate' | 'issuedAt' | 'dueAt' | 'category' | 'note' | 'ignore';
export type InvoiceMapping = Record<string, InvoiceImportField>;

export const INVOICE_FIELD_LABELS: Record<InvoiceImportField, string> = {
  counterparty: 'Tiers',
  number: 'Numéro',
  label: 'Libellé',
  amount: 'Montant TTC',
  vatRate: 'Taux de TVA',
  issuedAt: 'Date d’émission',
  dueAt: 'Échéance',
  category: 'Catégorie',
  note: 'Note',
  ignore: 'Ignorer',
};

const INVOICE_HINTS: [InvoiceImportField, RegExp][] = [
  ['dueAt', /(ch(e|é)ance|due|date limite|paiement pr(e|é)vu)/i],
  ['issuedAt', /((e|é)mission|date( de)? facture|^date$|issued)/i],
  ['counterparty', /(tiers|client|fournisseur|soci(e|é)t(e|é)|raison sociale|customer|supplier|contact)/i],
  ['number', /(num(e|é)ro|n°|no\.?|r(e|é)f(e|é)rence|^ref|invoice)/i],
  ['amount', /(ttc|montant|total|amount)/i],
  ['vatRate', /(taux.*tva|tva.*%|vat rate|taux)/i],
  ['label', /(libell|objet|description|intitul|d(e|é)signation)/i],
  ['category', /(cat(e|é)gorie|category|poste)/i],
  ['note', /(note|commentaire|m(e|é)mo)/i],
];

export function guessInvoiceMapping(headers: string[], previous?: InvoiceMapping | null): InvoiceMapping {
  const mapping: InvoiceMapping = {};
  const taken = new Set<InvoiceImportField>();
  for (const h of headers) {
    const prev = previous?.[h];
    if (prev && prev !== 'ignore' && !taken.has(prev)) {
      mapping[h] = prev;
      taken.add(prev);
    }
  }
  for (const h of headers) {
    if (mapping[h]) continue;
    const hit = INVOICE_HINTS.find(([f, re]) => !taken.has(f) && re.test(h.trim()));
    mapping[h] = hit ? hit[0] : 'ignore';
    if (hit) taken.add(hit[0]);
  }
  return mapping;
}

/** Champs requis d'un import de factures. */
export function missingInvoiceFields(mapping: InvoiceMapping): string[] {
  const fields = new Set(Object.values(mapping));
  const missing: string[] = [];
  if (!fields.has('counterparty') && !fields.has('label')) missing.push('Tiers ou Libellé');
  if (!fields.has('amount')) missing.push('Montant TTC');
  if (!fields.has('dueAt') && !fields.has('issuedAt')) missing.push('Échéance');
  return missing;
}

export interface ImportedInvoice {
  line: number;
  counterparty: string;
  number: string | null;
  label: string;
  amountInclTax: number;
  vatRate: number | null;
  issuedAt: IsoDate;
  dueAt: IsoDate;
  categoryId: string | null;
  categoryName: string | null;
  note: string | null;
}

export interface InvoiceImportPreview {
  rows: ImportedInvoice[];
  errors: { line: number; message: string }[];
  /** Lignes déjà présentes (même tiers, même numéro, ou même montant à la même échéance). */
  duplicates: number[];
  /** Noms de catégories inconnus (lignes importées « À catégoriser »). */
  unknownCategories: string[];
}

const VAT_RATES = [0, 2.1, 5.5, 10, 20];

export function previewInvoiceImport(
  rows: Record<string, unknown>[],
  mapping: InvoiceMapping,
  ctx: { flow: Commitment['flow']; categories: Category[]; existing: Commitment[]; today: IsoDate },
): InvoiceImportPreview {
  const col = (f: InvoiceImportField) => Object.keys(mapping).find((k) => mapping[k] === f);
  const get = (row: Record<string, unknown>, f: InvoiceImportField) => {
    const c = col(f);
    return c ? String(row[c] ?? '').trim() : '';
  };
  const catByName = new Map(ctx.categories.filter((c) => c.flow === ctx.flow).map((c) => [normalizeLabel(c.name), c]));
  const dupKey = (cp: string, num: string | null, amount: number, due: IsoDate) =>
    num ? `n|${normalizeLabel(cp)}|${alnum(num)}` : `a|${normalizeLabel(cp)}|${Math.round(amount * 100)}|${due}`;
  const known = new Set(ctx.existing.filter((c) => c.flow === ctx.flow).map((c) => dupKey(c.counterparty, c.number ?? null, c.amountInclTax, c.dueAt)));
  const seen = new Set<string>();
  const unknown = new Set<string>();
  const out: InvoiceImportPreview = { rows: [], errors: [], duplicates: [], unknownCategories: [] };

  rows.forEach((row, i) => {
    const line = i + 2;
    if (Object.values(row).every((v) => v == null || String(v).trim() === '')) return;
    const counterparty = get(row, 'counterparty') || get(row, 'label');
    if (!counterparty) return void out.errors.push({ line, message: `Tiers vide ligne ${line}.` });
    const rawAmount = get(row, 'amount');
    const amount = parseAmount(rawAmount);
    if (amount === null) return void out.errors.push({ line, message: `Montant illisible ligne ${line} : « ${rawAmount} ».` });
    if (amount === 0) return void out.errors.push({ line, message: `Montant nul ligne ${line}.` });
    const rawIssued = get(row, 'issuedAt');
    const rawDue = get(row, 'dueAt');
    const issued = rawIssued ? parseDate(rawIssued) : null;
    const due = rawDue ? parseDate(rawDue) : null;
    if ((rawIssued && !issued) || (rawDue && !due)) return void out.errors.push({ line, message: `Date illisible ligne ${line}.` });
    const dueAt = due ?? issued!;
    const issuedAt = issued ?? (dueAt < ctx.today ? dueAt : ctx.today);
    const rawVat = get(row, 'vatRate').replace('%', '').trim();
    let vatRate: number | null = null;
    if (rawVat) {
      const v = parseAmount(rawVat);
      const pct = v !== null && v > 0 && v < 1 ? round2(v * 100) : v;
      if (pct === null || !VAT_RATES.includes(Math.abs(pct))) return void out.errors.push({ line, message: `Taux de TVA inconnu ligne ${line} : « ${rawVat} ».` });
      vatRate = Math.abs(pct);
    }
    const catName = get(row, 'category') || null;
    const cat = catName ? catByName.get(normalizeLabel(catName)) : undefined;
    if (catName && !cat) unknown.add(catName);
    const number = get(row, 'number') || null;
    const key = dupKey(counterparty, number, Math.abs(amount), dueAt);
    if (known.has(key) || seen.has(key)) out.duplicates.push(line);
    seen.add(key);
    out.rows.push({
      line,
      counterparty,
      number,
      label: get(row, 'label') || (number ? `Facture ${number}` : counterparty),
      amountInclTax: Math.abs(amount),
      vatRate: vatRate ?? cat?.vatRate ?? null,
      issuedAt,
      dueAt,
      categoryId: cat?.id ?? null,
      categoryName: catName,
      note: get(row, 'note') || null,
    });
  });
  out.unknownCategories = [...unknown];
  return out;
}

// ───────────────────────── Relance ─────────────────────────

const eur = (n: number) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(n);
const frDate = (d: IsoDate) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;

/** Email de relance d'une facture client en retard, modifiable avant envoi. */
export function reminderEmail(c: Commitment, companyName: string, today: IsoDate): { subject: string; body: string } {
  const ref = c.number ? `n° ${c.number}` : `« ${c.label} »`;
  const days = Math.max(0, daysBetween(c.dueAt, today));
  return {
    subject: `Relance : facture ${ref} échue le ${frDate(c.dueAt)}`,
    body: [
      'Bonjour,',
      '',
      `Sauf erreur de notre part, la facture ${ref} d’un montant de ${eur(c.amountInclTax)}, arrivée à échéance le ${frDate(c.dueAt)}, reste impayée${days > 0 ? ` depuis ${days} jour${days > 1 ? 's' : ''}` : ''}.`,
      (c.amountPaid ?? 0) > 0 ? `Le reste à régler s’élève à ${eur(remainingOf(c))}.` : '',
      '',
      'Pourriez-vous procéder à son règlement dans les meilleurs délais ? Si le paiement a été effectué entre-temps, merci de ne pas tenir compte de ce message.',
      '',
      'Bien cordialement,',
      companyName,
    ]
      .filter((l, i, arr) => !(l === '' && arr[i - 1] === ''))
      .join('\n'),
  };
}
