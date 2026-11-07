/**
 * Exports (écran 7.5) : chaque contenu devient un tableau neutre (colonnes
 * typées + lignes) que l'interface écrit en XLSX mis en forme ou en CSV.
 * Import des budgets depuis le même modèle (aller-retour sans perte).
 */
import { parseAmount, parseDate } from './bank';
import { monthOf } from './dates';
import type { DayPoint } from './daily';
import { invoiceStatus, remainingOf, STATUS_LABELS } from './invoices';
import { displayValue, round2, UNCATEGORIZED_IN, UNCATEGORIZED_OUT, type PlanResult } from './plan';
import type { BankAccount, Budget, Category, Commitment, IsoDate, MonthKey, Scenario, Transaction } from './types';

export type ColumnType = 'text' | 'eur' | 'date' | 'month' | 'pct' | 'number';

export interface SheetColumn {
  header: string;
  type: ColumnType;
  width?: number;
}

/** Style d'une ligne : titre de section, total, ligne mise en avant. */
export type RowStyle = 'section' | 'total' | 'strong' | undefined;

export interface SheetSpec {
  /** Nom d'onglet (31 caractères maximum, sans : \ / ? * [ ]). */
  name: string;
  /** Nom de fichier CSV, sans extension. */
  file: string;
  title: string;
  columns: SheetColumn[];
  rows: (string | number | null)[][];
  rowStyles?: RowStyle[];
  /** Nombre de colonnes figées à gauche. */
  frozenColumns: number;
}

export type ExportContent = 'plan' | 'budgetVsActual' | 'budgets' | 'transactions' | 'invoices' | 'daily' | 'indicators';

export const EXPORT_CONTENT_LABELS: Record<ExportContent, string> = {
  plan: 'Plan de trésorerie',
  budgetVsActual: 'Prévu vs réalisé',
  budgets: 'Budgets saisis',
  transactions: 'Opérations bancaires',
  invoices: 'Factures',
  daily: 'Trésorerie au jour le jour',
  indicators: 'Indicateurs',
};

export const EXPORT_PERIOD_REQUIRED = 'Choisissez une période';
export const EXPORT_CONTENT_REQUIRED = 'Choisissez au moins un élément à exporter';

/** Nom d'onglet valide et unique. */
export function sheetName(raw: string, taken: Set<string>): string {
  let base = raw.replace(/[:\\/?*[\]]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 31) || 'Feuille';
  let name = base;
  for (let i = 2; taken.has(name.toLowerCase()); i++) {
    const suffix = ` (${i})`;
    name = base.slice(0, 31 - suffix.length) + suffix;
  }
  taken.add(name.toLowerCase());
  return name;
}

const fileName = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();

/** Chemin lisible d'une catégorie : « Charges de personnel › Salaires nets ». */
export function categoryPath(c: Category, byId: Map<string, Category>): string {
  const parts = [c.name];
  let p = c.parentId ? byId.get(c.parentId) : undefined;
  while (p) {
    parts.unshift(p.name);
    p = p.parentId ? byId.get(p.parentId) : undefined;
  }
  return parts.join(' › ');
}

/** Catégories dans l'ordre d'affichage du plan (encaissements puis décaissements, arborescence). */
export function orderedCategories(categories: Category[]): { category: Category; depth: number }[] {
  const out: { category: Category; depth: number }[] = [];
  const walk = (parentId: string | null, flow: Category['flow'], depth: number) => {
    categories
      .filter((c) => c.parentId === parentId && c.flow === flow)
      .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name, 'fr'))
      .forEach((c) => {
        out.push({ category: c, depth });
        walk(c.id, flow, depth + 1);
      });
  };
  walk(null, 'in', 0);
  walk(null, 'out', 0);
  return out;
}

// ───────────────────────── Contenus ─────────────────────────

export interface ExportContext {
  companyName: string;
  categories: Category[];
  accounts: BankAccount[];
  scenarios: Scenario[];
  today: IsoDate;
  months: MonthKey[];
  from: IsoDate;
  to: IsoDate;
}

const monthCols = (months: MonthKey[]): SheetColumn[] => months.map((m) => ({ header: m, type: 'month' as const, width: 13 }));

/** Plan de trésorerie d'un scénario : réalisé pour les mois passés, prévu ensuite. */
export function planSheet(plan: PlanResult, scenario: Scenario, ctx: ExportContext): Omit<SheetSpec, 'name'> {
  const sp = plan.scenarios[scenario.id]!;
  const months = ctx.months;
  const rows: SheetSpec['rows'] = [];
  const styles: RowStyle[] = [];
  const v = (cell: { actual: number; forecast: number } | undefined, m: MonthKey) => (cell ? round2(displayValue(cell, m, plan.currentMonth)) : 0);
  const push = (label: string, values: number[], total: number | null, style?: RowStyle) => {
    rows.push([label, ...values, total]);
    styles.push(style);
  };
  const sum = (a: number[]) => round2(a.reduce((s, x) => s + x, 0));
  push('Solde en début de mois', months.map((m) => sp.opening[m] ?? 0), null, 'strong');
  for (const flow of ['in', 'out'] as const) {
    const totals = months.map((m) => v(sp.totals[flow][m], m));
    push(flow === 'in' ? 'Encaissements' : 'Décaissements', totals, sum(totals), 'section');
    for (const { category, depth } of orderedCategories(ctx.categories).filter((r) => r.category.flow === flow)) {
      const values = months.map((m) => v(sp.rows[category.id]?.[m], m));
      push(`${'   '.repeat(depth + 1)}${category.name}`, values, sum(values));
    }
    const unc = flow === 'in' ? UNCATEGORIZED_IN : UNCATEGORIZED_OUT;
    const uv = months.map((m) => v(sp.rows[unc]?.[m], m));
    if (uv.some((x) => x !== 0)) push('   À catégoriser', uv, sum(uv));
  }
  const variation = months.map((m) => sp.variation[m] ?? 0);
  push('Variation du mois', variation, sum(variation), 'strong');
  push('Solde en fin de mois', months.map((m) => sp.closing[m] ?? 0), null, 'total');
  return {
    file: fileName(`plan-${scenario.name}`),
    title: `Plan de trésorerie · ${scenario.name}`,
    columns: [{ header: 'Ligne', type: 'text', width: 38 }, ...monthCols(months), { header: 'Total', type: 'eur', width: 14 }],
    rows,
    rowStyles: styles,
    frozenColumns: 1,
  };
}

/** Prévu vs réalisé par catégorie et par mois écoulé. */
export function budgetVsActualSheet(plan: PlanResult, scenario: Scenario, ctx: ExportContext): Omit<SheetSpec, 'name'> {
  const sp = plan.scenarios[scenario.id]!;
  const months = ctx.months.filter((m) => m < plan.currentMonth);
  const byId = new Map(ctx.categories.map((c) => [c.id, c]));
  const rows: SheetSpec['rows'] = [];
  for (const { category } of orderedCategories(ctx.categories)) {
    const cells = sp.rows[category.id];
    if (!cells || !cells[months[0] ?? '']?.editable) continue;
    for (const m of months) {
      const c = cells[m];
      if (!c || (c.budget === 0 && c.actual === 0)) continue;
      const gap = round2(c.actual - c.budget);
      rows.push([categoryPath(category, byId), category.flow === 'in' ? 'Encaissement' : 'Décaissement', m, c.budget, c.actual, gap, c.budget ? round2(gap / c.budget) : null]);
    }
  }
  return {
    file: fileName(`prevu-vs-realise-${scenario.name}`),
    title: `Prévu vs réalisé · ${scenario.name}`,
    columns: [
      { header: 'Catégorie', type: 'text', width: 40 },
      { header: 'Sens', type: 'text', width: 14 },
      { header: 'Mois', type: 'month', width: 12 },
      { header: 'Prévu', type: 'eur', width: 14 },
      { header: 'Réalisé', type: 'eur', width: 14 },
      { header: 'Écart', type: 'eur', width: 14 },
      { header: 'Écart %', type: 'pct', width: 10 },
    ],
    rows,
    frozenColumns: 1,
  };
}

export const BUDGET_SHEET_CATEGORY = 'Catégorie';
export const BUDGET_SHEET_FLOW = 'Sens';

/**
 * Budgets saisis d'un scénario, au format du modèle d'import :
 * une ligne par catégorie saisissable, une colonne par mois.
 */
export function budgetsSheet(budgets: Budget[], scenario: Scenario, ctx: ExportContext): Omit<SheetSpec, 'name'> {
  const byId = new Map(ctx.categories.map((c) => [c.id, c]));
  const parents = new Set(ctx.categories.map((c) => c.parentId).filter(Boolean));
  const own = new Map(budgets.filter((b) => b.scenarioId === scenario.id).map((b) => [`${b.categoryId}|${b.month}`, b.amount]));
  const rows: SheetSpec['rows'] = [];
  for (const { category } of orderedCategories(ctx.categories)) {
    if (parents.has(category.id) && !category.budgetAtParent) continue;
    rows.push([
      categoryPath(category, byId),
      category.flow === 'in' ? 'Encaissement' : 'Décaissement',
      ...ctx.months.map((m) => own.get(`${category.id}|${m}`) ?? null),
    ]);
  }
  return {
    file: fileName(`budgets-${scenario.name}`),
    title: `Budgets saisis · ${scenario.name}`,
    columns: [{ header: BUDGET_SHEET_CATEGORY, type: 'text', width: 42 }, { header: BUDGET_SHEET_FLOW, type: 'text', width: 14 }, ...monthCols(ctx.months)],
    rows,
    frozenColumns: 2,
  };
}

export function transactionsSheet(transactions: Transaction[], ctx: ExportContext): Omit<SheetSpec, 'name'> {
  const byId = new Map(ctx.categories.map((c) => [c.id, c]));
  const accounts = new Map(ctx.accounts.map((a) => [a.id, a.displayName || a.name]));
  const rows = transactions
    .filter((t) => !t.isSplit && t.bookedAt >= ctx.from && t.bookedAt <= ctx.to)
    .sort((a, b) => a.bookedAt.localeCompare(b.bookedAt))
    .map((t) => {
      const cat = t.categoryId ? byId.get(t.categoryId) : undefined;
      return [t.bookedAt, accounts.get(t.accountId) ?? '', t.label, t.counterparty ?? '', cat ? categoryPath(cat, byId) : 'À catégoriser', t.amount, t.hidden ? 'Oui' : '', t.note ?? ''];
    });
  return {
    file: 'operations-bancaires',
    title: 'Opérations bancaires',
    columns: [
      { header: 'Date', type: 'date', width: 12 },
      { header: 'Compte', type: 'text', width: 22 },
      { header: 'Libellé', type: 'text', width: 40 },
      { header: 'Tiers', type: 'text', width: 24 },
      { header: 'Catégorie', type: 'text', width: 34 },
      { header: 'Montant', type: 'eur', width: 14 },
      { header: 'Exclue', type: 'text', width: 8 },
      { header: 'Note', type: 'text', width: 30 },
    ],
    rows,
    frozenColumns: 1,
  };
}

export type InvoiceFlowFilter = 'both' | 'in' | 'out';
export type InvoiceStatusFilter = 'all' | 'upcoming' | 'overdue';

export function invoicesSheet(commitments: Commitment[], ctx: ExportContext, flow: InvoiceFlowFilter, status: InvoiceStatusFilter): Omit<SheetSpec, 'name'> {
  const byId = new Map(ctx.categories.map((c) => [c.id, c]));
  const accounts = new Map(ctx.accounts.map((a) => [a.id, a.displayName || a.name]));
  const rows = commitments
    .filter((c) => !c.replacedBy && c.status !== 'cancelled' && (flow === 'both' || c.flow === flow))
    .filter((c) => {
      const s = invoiceStatus(c, ctx.today).status;
      if (status === 'upcoming') return s === 'upcoming' || s === 'partial';
      if (status === 'overdue') return s === 'overdue';
      return c.dueAt >= ctx.from && c.dueAt <= ctx.to;
    })
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt))
    .map((c) => {
      const cat = c.categoryId ? byId.get(c.categoryId) : undefined;
      const st = invoiceStatus(c, ctx.today);
      return [
        c.flow === 'in' ? 'Client' : 'Fournisseur',
        c.dueAt,
        c.issuedAt,
        c.counterparty,
        c.number ?? '',
        c.label,
        cat ? categoryPath(cat, byId) : 'À catégoriser',
        STATUS_LABELS[st.status] + (st.daysLate ? ` (+${st.daysLate} j)` : ''),
        c.amountInclTax,
        c.vatAmount ?? null,
        remainingOf(c),
        c.accountId ? (accounts.get(c.accountId) ?? '') : '',
      ];
    });
  const label = flow === 'in' ? 'clients' : flow === 'out' ? 'fournisseurs' : '';
  return {
    file: fileName(`factures-${label}`),
    title: `Factures ${label}`.trim(),
    columns: [
      { header: 'Type', type: 'text', width: 12 },
      { header: 'Échéance', type: 'date', width: 12 },
      { header: 'Émission', type: 'date', width: 12 },
      { header: 'Tiers', type: 'text', width: 26 },
      { header: 'Numéro', type: 'text', width: 16 },
      { header: 'Libellé', type: 'text', width: 28 },
      { header: 'Catégorie', type: 'text', width: 30 },
      { header: 'Statut', type: 'text', width: 20 },
      { header: 'Montant TTC', type: 'eur', width: 14 },
      { header: 'TVA', type: 'eur', width: 12 },
      { header: 'Reste à payer', type: 'eur', width: 14 },
      { header: 'Compte', type: 'text', width: 20 },
    ],
    rows,
    frozenColumns: 2,
  };
}

export function dailySheet(points: Pick<DayPoint, 'date' | 'inActual' | 'inPlanned' | 'outActual' | 'outPlanned' | 'closing'>[]): Omit<SheetSpec, 'name'> {
  return {
    file: 'tresorerie-au-jour-le-jour',
    title: 'Trésorerie au jour le jour',
    columns: [
      { header: 'Date', type: 'date', width: 12 },
      { header: 'Entrées réalisées', type: 'eur', width: 16 },
      { header: 'Entrées prévues', type: 'eur', width: 16 },
      { header: 'Sorties réalisées', type: 'eur', width: 16 },
      { header: 'Sorties prévues', type: 'eur', width: 16 },
      { header: 'Solde de fin de journée', type: 'eur', width: 22 },
    ],
    rows: points.map((p) => [p.date, p.inActual, p.inPlanned, p.outActual, p.outPlanned, p.closing]),
    frozenColumns: 1,
  };
}

export function indicatorsSheet(
  indicators: { name: string; unit: string; values: (number | null)[] }[],
  scenario: Scenario,
  ctx: ExportContext,
): Omit<SheetSpec, 'name'> {
  return {
    file: fileName(`indicateurs-${scenario.name}`),
    title: `Indicateurs · ${scenario.name}`,
    columns: [{ header: 'Indicateur', type: 'text', width: 34 }, { header: 'Unité', type: 'text', width: 8 }, ...ctx.months.map((m) => ({ header: m, type: 'month' as const, width: 12 }))],
    rows: indicators.map((i) => [i.name, i.unit, ...i.values.map((v) => (v === null || !Number.isFinite(v) ? null : round2(v)))]),
    frozenColumns: 1,
  };
}

// ───────────────────────── CSV ─────────────────────────

const csvCell = (v: string | number | null, type: ColumnType): string => {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') {
    const n = type === 'pct' ? round2(v * 100) : v;
    return String(n).replace('.', ',');
  }
  if (type === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return `${v.slice(8, 10)}/${v.slice(5, 7)}/${v.slice(0, 4)}`;
  return /[;"\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
};

const monthHeader = (m: string) => `${m.slice(5, 7)}/${m.slice(0, 4)}`;

/** CSV « à la française » : point-virgule, virgule décimale, BOM UTF-8 pour Excel. */
export function sheetToCsv(sheet: Pick<SheetSpec, 'columns' | 'rows'>): string {
  const head = sheet.columns.map((c) => csvCell(c.type === 'month' ? monthHeader(c.header) : c.header, 'text')).join(';');
  const body = sheet.rows.map((r) =>
    r
      .map((v, i) => {
        const type = sheet.columns[i]?.type ?? 'text';
        if (type === 'month') return typeof v === 'string' ? monthHeader(v) : csvCell(v, 'eur');
        return csvCell(v, type);
      })
      .join(';'),
  );
  return '﻿' + [head, ...body].join('\r\n') + '\r\n';
}

// ───────────────────────── Import des budgets ─────────────────────────

export interface BudgetImportResult {
  changes: Budget[];
  months: MonthKey[];
  /** Lignes lues avec au moins un montant. */
  rows: number;
  errors: { row: number; message: string }[];
  unknownCategories: string[];
}

const MONTH_WORDS: [string, number][] = [
  ['janv', 0], ['jan', 0], ['fevr', 1], ['fev', 1], ['feb', 1], ['mars', 2], ['mar', 2], ['avr', 3], ['apr', 3],
  ['mai', 4], ['may', 4], ['juin', 5], ['jun', 5], ['juil', 6], ['jul', 6], ['aout', 7], ['aug', 7],
  ['sept', 8], ['sep', 8], ['oct', 9], ['nov', 10], ['dec', 11],
];

/** En-tête de colonne → mois : Date, « 2026-11 », « 11/2026 », « nov. 2026 », « novembre 2026 ». */
export function parseMonthHeader(v: unknown): MonthKey | null {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return `${v.getUTCFullYear()}-${String(v.getUTCMonth() + 1).padStart(2, '0')}-01`;
  if (typeof v !== 'string' && typeof v !== 'number') return null;
  const s = String(v)
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
  let m = /^(\d{4})-(\d{1,2})(?:-01)?$/.exec(s);
  if (m) return mk(+m[1]!, +m[2]!);
  m = /^(\d{1,2})[/.-](\d{4})$/.exec(s);
  if (m) return mk(+m[2]!, +m[1]!);
  m = /^01[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
  if (m) return mk(+m[2]!, +m[1]!);
  m = /^([a-z]+)\.?\s*[-' ]?\s*(\d{2}|\d{4})$/.exec(s);
  if (m) {
    const word = m[1]!;
    const hit = MONTH_WORDS.find(([w]) => word.startsWith(w));
    const year = m[2]!.length === 2 ? 2000 + Number(m[2]) : Number(m[2]);
    if (hit) return mk(year, hit[1] + 1);
  }
  const d = parseDate(s);
  return d ? monthOf(d) : null;
}
const mk = (y: number, mo: number): MonthKey | null => (mo >= 1 && mo <= 12 && y >= 2000 && y <= 2100 ? `${y}-${String(mo).padStart(2, '0')}-01` : null);

const norm = (s: string) =>
  s
    .trim()
    .toLocaleLowerCase('fr')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s*[›>/]\s*/g, '›')
    .replace(/\s+/g, ' ');

/**
 * Lit une feuille de budgets (modèle exporté ou tableau maison) : la ligne
 * d'en-tête est la première qui contient au moins un mois. La catégorie est
 * reconnue par son chemin (« Parent › Enfant ») ou son nom seul.
 * Cellule vide = budget inchangé, sauf avec `clearEmpty`.
 */
export function parseBudgetSheet(
  matrix: unknown[][],
  categories: Category[],
  scenarioId: string,
  options: { clearEmpty?: boolean } = {},
): BudgetImportResult {
  const res: BudgetImportResult = { changes: [], months: [], rows: 0, errors: [], unknownCategories: [] };
  const headerIdx = matrix.findIndex((r) => r.some((v) => parseMonthHeader(v) !== null));
  if (headerIdx < 0) {
    res.errors.push({ row: 1, message: 'Aucune colonne de mois trouvée (ex. : « 2027-01 », « janv. 2027 »).' });
    return res;
  }
  const header = matrix[headerIdx]!;
  const monthCol = new Map<number, MonthKey>();
  header.forEach((v, i) => {
    const m = parseMonthHeader(v);
    if (m) monthCol.set(i, m);
  });
  res.months = [...new Set(monthCol.values())].sort();
  const firstMonthCol = Math.min(...monthCol.keys());
  const catCol = header.findIndex((v, i) => i < firstMonthCol && typeof v === 'string' && norm(v).startsWith('categ'));
  const labelCol = catCol >= 0 ? catCol : 0;

  const byId = new Map(categories.map((c) => [c.id, c]));
  const parents = new Set(categories.map((c) => c.parentId).filter(Boolean));
  const byPath = new Map<string, Category>();
  const byName = new Map<string, Category[]>();
  for (const c of categories) {
    byPath.set(norm(categoryPath(c, byId)), c);
    const n = norm(c.name);
    byName.set(n, [...(byName.get(n) ?? []), c]);
  }

  for (let r = headerIdx + 1; r < matrix.length; r++) {
    const line = matrix[r] ?? [];
    const rawLabel = String(line[labelCol] ?? '').trim();
    const cells = [...monthCol.entries()].map(([i, m]) => ({ m, v: line[i] }));
    const hasValue = cells.some((c) => c.v !== null && c.v !== undefined && String(c.v).trim() !== '');
    if (!rawLabel) {
      if (hasValue) res.errors.push({ row: r + 1, message: `Ligne ${r + 1} : catégorie manquante.` });
      continue;
    }
    const key = norm(rawLabel);
    const cat = byPath.get(key) ?? (byName.get(key)?.length === 1 ? byName.get(key)![0] : undefined);
    if (!cat) {
      if (byName.get(key)?.length) res.errors.push({ row: r + 1, message: `Ligne ${r + 1} : « ${rawLabel} » existe plusieurs fois, indiquez le chemin (Parent › ${rawLabel}).` });
      else if (hasValue) res.unknownCategories.push(rawLabel);
      continue;
    }
    if (parents.has(cat.id) && !cat.budgetAtParent) {
      if (hasValue) res.errors.push({ row: r + 1, message: `Ligne ${r + 1} : « ${cat.name} » se calcule à partir de ses sous-catégories.` });
      continue;
    }
    let counted = false;
    for (const { m, v } of cells) {
      const empty = v === null || v === undefined || String(v).trim() === '';
      if (empty) {
        if (options.clearEmpty) res.changes.push({ scenarioId, categoryId: cat.id, month: m, amount: null });
        continue;
      }
      const n = typeof v === 'number' ? v : parseAmount(String(v));
      if (n === null || !Number.isFinite(n)) {
        res.errors.push({ row: r + 1, message: `Ligne ${r + 1} : montant illisible « ${String(v)} ».` });
        continue;
      }
      res.changes.push({ scenarioId, categoryId: cat.id, month: m, amount: round2(Math.abs(n)) });
      counted = true;
    }
    if (counted) res.rows++;
  }
  return res;
}
