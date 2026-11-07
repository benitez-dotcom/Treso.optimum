/**
 * Opérations bancaires (lot 2) : libellés, exclusions automatiques, import de
 * fichiers, divisions et règles. Module pur, testé dans `test/bank.test.ts`.
 */
import { normalizeLabel, type Rule, type RuleCondition } from './categorize';
import { daysBetween } from './dates';
import type { HiddenReason, IsoDate, Transaction } from './types';

// ───────────────────────── Libellés ─────────────────────────

const NOISE_PREFIXES = [
  /^(prlv|prelevement)( sepa)?\b/i,
  /^(vir|virement)( (sepa|inst(antane)?|instantane))?( (recu|emis|permanent))?( de| a| vers| pour)?\b/i,
  /^(paiement|achat|retrait)( (par )?(carte|cb))?\b/i,
  /^(carte|cb)( ?x+\d{2,4}| \d{4})?\b/i,
  /^(cheque|chq)\b/i,
  /^(frais|commission)\b/i,
];

const NOISE_TOKENS =
  /\b(cb|sepa|rcur|frst|ooff|ref|refs|mandat|ich|ics|rum|recu|emis|inst|du|le|de la|pour|motif|ech(eance)?|fact(ure)?|n°|no|num)\b\.?/gi;

/** Sigles conservés en capitales. */
const ACRONYMS = new Set([
  'urssaf', 'sncf', 'ratp', 'edf', 'gdf', 'sfr', 'tva', 'sa', 'sas', 'sasu', 'sarl', 'eurl', 'sci', 'dgfip', 'cpam', 'caf', 'bnp',
  'lcl', 'cic', 'bpi', 'ovh', 'ht', 'ttc', 'msa', 'cfe', 'ircem', 'apec', 'agirc', 'arrco', 'pme', 'tpe', 'axa', 'maaf', 'macif', 'mma',
]);

/** Met une majuscule à chaque mot ; les sigles connus restent en capitales. */
function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split(' ')
    .filter(Boolean)
    .map((w) => (ACRONYMS.has(w) ? w.toUpperCase() : w[0]!.toUpperCase() + w.slice(1)))
    .join(' ');
}

export interface CleanLabel {
  /** Libellé lisible, affiché en gras. */
  label: string;
  /** Tiers détecté (sert au regroupement et aux suggestions). */
  counterparty: string | null;
}

/**
 * Nettoie un libellé bancaire brut : retire préfixes techniques (PRLV SEPA,
 * VIR INST RECU, CARTE X1234 05/11…), références, dates et montants.
 * « PRLV SEPA URSSAF AQUITAINE REF 123456 » → { label: « Urssaf Aquitaine », counterparty: « Urssaf Aquitaine » }.
 */
export function cleanBankLabel(raw: string): CleanLabel {
  let s = raw
    .normalize('NFC')
    .replace(/\s+/g, ' ')
    .trim();
  for (let i = 0; i < 3; i++) for (const p of NOISE_PREFIXES) s = s.replace(p, '').trim();
  s = s
    .replace(/\b\d{1,2}[/.-]\d{1,2}([/.-]\d{2,4})?\b/g, ' ') // dates
    .replace(/\b\d{1,2}h\d{2}\b/gi, ' ') // heures
    .replace(/\b[A-Z]{2}\d{2}[A-Z0-9]{8,}\b/g, ' ') // IBAN, ICS
    .replace(/\b[A-Z0-9]*\d[A-Z0-9]{5,}\b/gi, ' ') // références alphanumériques
    .replace(/\b\d+([.,]\d+)?\s?(eur|€)?\b/gi, ' ') // nombres, montants
    .replace(/[*#:_/\\|()[\]{}]+/g, ' ')
    .replace(NOISE_TOKENS, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[-.\s]+|[-.\s]+$/g, '')
    .trim();
  // Mots porteurs de sens : on écarte les lettres isolées (« F » de « F-2026-… »), sauf la civilité « M » en tête
  const words = s
    .split(' ')
    .filter((w, i) => /[A-Za-zÀ-ÿ]/.test(w) && (w.length > 1 || (i === 0 && /^m$/i.test(w))))
    .slice(0, 4);
  if (words.length === 0) {
    const fallback = titleCase(raw.replace(/\s+/g, ' ').trim().slice(0, 40));
    return { label: fallback, counterparty: null };
  }
  const label = titleCase(words.join(' '));
  return { label, counterparty: label };
}

// ───────────────────────── Exclusions automatiques ─────────────────────────

export interface AutoHideSettings {
  refunds: boolean;
  internalTransfers: boolean;
}

/**
 * Détecte les opérations à exclure des totaux (règle 5.10, point 5) :
 * - remboursement : paire débit/crédit de même montant absolu sur le même compte,
 *   libellés proches (même libellé nettoyé), à 30 jours d'écart au plus ;
 * - virement interne : montants opposés entre deux comptes de la société, à 3 jours d'écart au plus.
 * Ne touche ni aux opérations déjà catégorisées ou exclues, ni aux lignes de division.
 * Chaque opération n'appartient qu'à une paire.
 */
export function detectAutoExclusions(transactions: Transaction[], settings: AutoHideSettings): Map<string, HiddenReason> {
  const result = new Map<string, HiddenReason>();
  const candidates = transactions
    .filter((t) => !t.hidden && !t.categoryId && !t.parentId && !t.isSplit && t.amount !== 0)
    .sort((a, b) => a.bookedAt.localeCompare(b.bookedAt) || a.id.localeCompare(b.id));
  const used = new Set<string>();
  const pair = (maxDays: number, reason: HiddenReason, sameAccount: boolean, sameLabel: boolean) => {
    for (const a of candidates) {
      if (used.has(a.id) || a.amount >= 0) continue;
      const cents = Math.round(-a.amount * 100);
      const match = candidates.find(
        (b) =>
          !used.has(b.id) &&
          b.id !== a.id &&
          Math.round(b.amount * 100) === cents &&
          (sameAccount ? b.accountId === a.accountId : b.accountId !== a.accountId) &&
          Math.abs(daysBetween(a.bookedAt, b.bookedAt)) <= maxDays &&
          (!sameLabel || normalizeLabel(a.rawLabel) === normalizeLabel(b.rawLabel)),
      );
      if (match) {
        used.add(a.id).add(match.id);
        result.set(a.id, reason).set(match.id, reason);
      }
    }
  };
  if (settings.internalTransfers) pair(3, 'internal_transfer', false, false);
  if (settings.refunds) pair(30, 'refund', true, true);
  return result;
}

// ───────────────────────── Import de fichiers ─────────────────────────

/** Champs cibles d'un import d'opérations. */
export type TransactionImportField = 'date' | 'label' | 'amount' | 'debit' | 'credit' | 'category' | 'note' | 'externalId' | 'ignore';

export type ImportMapping = Record<string, TransactionImportField>;

const FIELD_HINTS: [TransactionImportField, RegExp][] = [
  ['date', /^(date( (op(e|é)ration|valeur|comptable))?|jour|booking ?date)$/i],
  ['label', /(libell|description|intitul|label|wording|d(e|é)tail)/i],
  ['debit', /(d(e|é)bit|sortie|retrait)/i],
  ['credit', /(cr(e|é)dit|entr(e|é)e|versement)/i],
  ['amount', /(montant|amount|somme|valeur)/i],
  ['category', /(cat(e|é)gorie|category|poste)/i],
  ['note', /(note|m(e|é)mo|commentaire)/i],
  ['externalId', /^(id|identifiant|r(e|é)f(e|é)rence|ref)$/i],
];

/** Propose une correspondance colonnes → champs d'après les en-têtes (corrigeable par l'utilisateur). */
export function guessMapping(headers: string[], previous?: ImportMapping | null): ImportMapping {
  const mapping: ImportMapping = {};
  const taken = new Set<TransactionImportField>();
  for (const h of headers) {
    const prev = previous?.[h];
    if (prev && prev !== 'ignore' && !taken.has(prev)) {
      mapping[h] = prev;
      taken.add(prev);
    }
  }
  for (const h of headers) {
    if (mapping[h]) continue;
    const hit = FIELD_HINTS.find(([f, re]) => !taken.has(f) && re.test(h.trim()));
    mapping[h] = hit ? hit[0] : 'ignore';
    if (hit) taken.add(hit[0]);
  }
  return mapping;
}

/** Lit un montant au format français ou anglais : « 1 234,56 », « -1.234,56 € », « (120,00) », « 1,234.56 ». */
export function parseAmount(input: unknown): number | null {
  if (typeof input === 'number') return Number.isFinite(input) ? Math.round(input * 100) / 100 : null;
  if (typeof input !== 'string') return null;
  let s = input.trim().replace(/[\s  €]|EUR/gi, '');
  if (!s) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (s.endsWith('-')) {
    negative = true;
    s = s.slice(0, -1);
  }
  if (s.startsWith('-')) {
    negative = !negative;
    s = s.slice(1);
  } else if (s.startsWith('+')) s = s.slice(1);
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
  else if (lastDot > lastComma && lastComma >= 0) s = s.replace(/,/g, '');
  else if (lastComma < 0 && (s.match(/\./g) ?? []).length > 1) s = s.replace(/\./g, '');
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Math.round(Number(s) * 100) / 100;
  return negative ? -n : n;
}

/** Lit une date « 05/11/2026 », « 5/11/26 », « 2026-11-05 », « 05.11.2026 » (jour avant mois). */
export function parseDate(input: unknown): IsoDate | null {
  if (typeof input !== 'string') return null;
  const s = input.trim();
  let y: number, m: number, d: number;
  let r = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (r) [y, m, d] = [Number(r[1]), Number(r[2]), Number(r[3])];
  else {
    r = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(s);
    if (!r) return null;
    [d, m, y] = [Number(r[1]), Number(r[2]), Number(r[3])];
    if (y < 100) y += 2000;
  }
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export interface ImportedRow {
  line: number;
  bookedAt: IsoDate;
  rawLabel: string;
  amount: number;
  categoryName: string | null;
  note: string | null;
  externalId: string | null;
}

export interface ImportRowError {
  line: number;
  message: string;
}

export interface ImportPreview {
  rows: ImportedRow[];
  errors: ImportRowError[];
  /** Lignes déjà présentes (même date, même montant, même libellé nettoyé). */
  duplicates: number[];
}

/** Champs requis : une date, un libellé et un montant (ou débit et/ou crédit). */
export function missingFields(mapping: ImportMapping): string[] {
  const fields = new Set(Object.values(mapping));
  const missing: string[] = [];
  if (!fields.has('date')) missing.push('Date');
  if (!fields.has('label')) missing.push('Libellé');
  if (!fields.has('amount') && !fields.has('debit') && !fields.has('credit')) missing.push('Montant');
  return missing;
}

const dupKey = (date: IsoDate, amount: number, rawLabel: string) => `${date}|${Math.round(amount * 100)}|${normalizeLabel(rawLabel)}`;

/**
 * Convertit des lignes de tableur (objets colonne → valeur) en opérations, avec
 * les erreurs ligne par ligne et les doublons d'opérations déjà connues.
 * `line` = numéro de ligne dans le fichier (en-tête = 1).
 */
export function previewImport(rows: Record<string, unknown>[], mapping: ImportMapping, existing: Pick<Transaction, 'bookedAt' | 'amount' | 'rawLabel'>[]): ImportPreview {
  const col = (f: TransactionImportField) => Object.keys(mapping).find((k) => mapping[k] === f);
  const cDate = col('date'), cLabel = col('label'), cAmount = col('amount'), cDebit = col('debit'), cCredit = col('credit');
  const cCat = col('category'), cNote = col('note'), cId = col('externalId');
  const known = new Set(existing.map((t) => dupKey(t.bookedAt, t.amount, t.rawLabel)));
  const seen = new Set<string>();
  const out: ImportPreview = { rows: [], errors: [], duplicates: [] };
  rows.forEach((row, i) => {
    const line = i + 2;
    const cells = Object.values(row).map((v) => (v == null ? '' : String(v).trim()));
    if (cells.every((v) => v === '')) return;
    const bookedAt = cDate ? parseDate(String(row[cDate] ?? '')) : null;
    if (!bookedAt) return void out.errors.push({ line, message: `Date illisible : « ${String(cDate ? row[cDate] ?? '' : '')} ».` });
    const rawLabel = cLabel ? String(row[cLabel] ?? '').trim() : '';
    if (!rawLabel) return void out.errors.push({ line, message: 'Libellé vide.' });
    let amount: number | null = null;
    if (cAmount && String(row[cAmount] ?? '').trim() !== '') amount = parseAmount(row[cAmount]);
    else {
      const debit = cDebit && String(row[cDebit] ?? '').trim() !== '' ? parseAmount(row[cDebit]) : null;
      const credit = cCredit && String(row[cCredit] ?? '').trim() !== '' ? parseAmount(row[cCredit]) : null;
      if (debit !== null || credit !== null) amount = Math.round(((credit ?? 0) - Math.abs(debit ?? 0)) * 100) / 100;
    }
    if (amount === null) return void out.errors.push({ line, message: 'Montant illisible ou absent.' });
    if (amount === 0) return void out.errors.push({ line, message: 'Montant nul.' });
    const key = dupKey(bookedAt, amount, rawLabel);
    if (known.has(key) || seen.has(key)) out.duplicates.push(line);
    seen.add(key);
    out.rows.push({
      line,
      bookedAt,
      rawLabel,
      amount,
      categoryName: cCat ? String(row[cCat] ?? '').trim() || null : null,
      note: cNote ? String(row[cNote] ?? '').trim() || null : null,
      externalId: cId ? String(row[cId] ?? '').trim() || null : null,
    });
  });
  return out;
}

// ───────────────────────── Divisions ─────────────────────────

/**
 * Répartit `amount` selon des pourcentages (somme = 100) ; la dernière ligne
 * prend le reste pour que le total tombe juste au centime.
 */
export function splitByPercentages(amount: number, percentages: number[]): number[] {
  const total = percentages.reduce((s, p) => s + p, 0);
  if (percentages.length < 2 || Math.abs(total - 100) > 0.001) throw new RangeError('Les pourcentages doivent totaliser 100 %.');
  const cents = Math.round(amount * 100);
  const out: number[] = [];
  let used = 0;
  percentages.forEach((p, i) => {
    const part = i === percentages.length - 1 ? cents - used : Math.round((cents * p) / 100);
    used += part;
    out.push(part / 100);
  });
  return out;
}

/** Contrôle d'une division avant enregistrement : lignes du même sens, non nulles, reste à 0. */
export function validateSplit(amount: number, lines: number[]): string | null {
  if (lines.length < 2) return 'Une division compte au moins 2 lignes.';
  if (lines.some((l) => l === 0)) return 'Chaque ligne doit avoir un montant.';
  if (lines.some((l) => Math.sign(l) !== Math.sign(amount))) return "Toutes les lignes doivent être dans le sens de l'opération.";
  const cents = Math.round(amount * 100) - lines.reduce((s, l) => s + Math.round(l * 100), 0);
  if (cents !== 0) return `Reste à répartir : ${(cents / 100).toFixed(2).replace('.', ',')} €.`;
  return null;
}

// ───────────────────────── Règles ─────────────────────────

/** La règle s'applique-t-elle à cette opération ? (toutes les conditions doivent correspondre) */
export function ruleMatches(rule: Pick<Rule, 'conditions'>, t: Pick<Transaction, 'rawLabel' | 'amount' | 'accountId'>): boolean {
  return rule.conditions.every((c) => {
    if (c.field === 'label') {
      const hay = normalizeLabel(t.rawLabel);
      const needle = normalizeLabel(c.value);
      if (!needle) return false;
      return c.op === 'contains' ? hay.includes(needle) : hay.startsWith(needle);
    }
    if (c.field === 'amount') return t.amount >= c.min && t.amount <= c.max;
    return t.accountId === c.value;
  });
}

/** Opérations concernées par une règle (aperçu de l'éditeur, compteur de la liste). */
export function ruleMatchesIn(rule: Pick<Rule, 'conditions'>, transactions: Transaction[]): Transaction[] {
  return transactions.filter((t) => !t.isSplit && ruleMatches(rule, t));
}

/** Condition lisible : « Libellé contient URSSAF », « Montant entre −500 € et −100 € ». */
export function describeCondition(c: RuleCondition, accountName?: (id: string) => string): string {
  if (c.field === 'label') return `Libellé ${c.op === 'contains' ? 'contient' : 'commence par'} « ${c.value} »`;
  if (c.field === 'amount') {
    const f = (n: number) => `${n.toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} €`;
    return `Montant entre ${f(c.min)} et ${f(c.max)}`;
  }
  return `Compte : ${accountName ? accountName(c.value) : c.value}`;
}

/** Proposition de condition pour « Créer une règle » depuis une opération catégorisée. */
export function proposeRuleFrom(t: Pick<Transaction, 'rawLabel' | 'counterparty'>): RuleCondition {
  const base = t.counterparty ?? cleanBankLabel(t.rawLabel).counterparty ?? t.rawLabel;
  const value = normalizeLabel(base).split(' ').slice(0, 3).join(' ') || normalizeLabel(t.rawLabel).split(' ').slice(0, 3).join(' ');
  return { field: 'label', op: 'contains', value };
}

// ───────────────────────── Recherche ─────────────────────────

/**
 * Recherche plein texte des opérations : libellé, tiers, note, montant exact
 * (« 120,50 ») ou approché (« ~120 » = à 10 % près).
 */
export function matchesSearch(t: Pick<Transaction, 'rawLabel' | 'label' | 'counterparty' | 'note' | 'amount'>, query: string): boolean {
  const q = query.trim();
  if (!q) return true;
  const approx = /^~\s*(.+)$/.exec(q);
  if (approx) {
    const n = parseAmount(approx[1]);
    if (n === null) return false;
    const target = Math.abs(n);
    return Math.abs(Math.abs(t.amount) - target) <= target * 0.1;
  }
  const n = /^[-+]?[\d\s.,]+$/.test(q) ? parseAmount(q) : null;
  if (n !== null && Math.abs(Math.abs(t.amount) - Math.abs(n)) < 0.005) return true;
  const needle = normalizeLabel(q);
  if (!needle) return false;
  return [t.rawLabel, t.label, t.counterparty ?? '', t.note ?? ''].some((s) => normalizeLabel(s).includes(needle));
}

/** Nombre de jours entre la date bancaire et la date d'imputation (affichage de l'icône « date modifiée »). */
export const dateShift = (t: Pick<Transaction, 'bookedAt' | 'originalBookedAt'>) =>
  t.originalBookedAt ? daysBetween(t.originalBookedAt, t.bookedAt) : 0;
