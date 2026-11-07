/**
 * Indicateurs personnalisés (règle 5.6) : parseur arithmétique et évaluation
 * par parcours d'arbre. Aucun `eval`.
 */
import type { MonthKey } from './types';
import type { PlanResult } from './plan';

export type Expr =
  | { type: 'number'; value: number }
  | { type: 'category'; id: string }
  | { type: 'line'; line: 'in' | 'out' | 'closing' }
  | { type: 'op'; op: '+' | '-' | '*' | '/'; left: Expr; right: Expr }
  | { type: 'neg'; expr: Expr };

export class FormulaError extends Error {}

type Token =
  | { kind: 'num'; value: number }
  | { kind: 'ref'; name: string }
  | { kind: 'op'; value: '+' | '-' | '*' | '/' }
  | { kind: 'lp' }
  | { kind: 'rp' };

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i]!;
    if (/\s/.test(ch)) {
      i++;
    } else if (ch === '[') {
      const end = src.indexOf(']', i);
      if (end < 0) throw new FormulaError('Crochet fermant manquant.');
      tokens.push({ kind: 'ref', name: src.slice(i + 1, end).trim() });
      i = end + 1;
    } else if (/[0-9]/.test(ch)) {
      let j = i;
      while (j < src.length && /[0-9.,]/.test(src[j]!)) j++;
      const raw = src.slice(i, j).replace(',', '.');
      const value = Number(raw);
      if (Number.isNaN(value)) throw new FormulaError(`Nombre invalide : ${raw}`);
      tokens.push({ kind: 'num', value });
      i = j;
    } else if ('+-*/×÷'.includes(ch)) {
      const map: Record<string, '+' | '-' | '*' | '/'> = { '+': '+', '-': '-', '*': '*', '/': '/', '×': '*', '÷': '/' };
      tokens.push({ kind: 'op', value: map[ch]! });
      i++;
    } else if (ch === '(') {
      tokens.push({ kind: 'lp' });
      i++;
    } else if (ch === ')') {
      tokens.push({ kind: 'rp' });
      i++;
    } else {
      throw new FormulaError(`Caractère inattendu : « ${ch} ».`);
    }
  }
  return tokens;
}

/**
 * Analyse une formule textuelle. Les catégories et lignes s'écrivent entre
 * crochets : `[Achats] / 1,2 / ([Ventes] / 1,1) * 100`.
 * `resolve` convertit un nom en référence (ou `null` si inconnu).
 */
export function parseFormula(src: string, resolve: (name: string) => Expr | null): Expr {
  const tokens = tokenize(src);
  let pos = 0;
  const peek = () => tokens[pos];

  const primary = (): Expr => {
    const t = tokens[pos++];
    if (!t) throw new FormulaError('Formule incomplète.');
    if (t.kind === 'num') return { type: 'number', value: t.value };
    if (t.kind === 'ref') {
      const ref = resolve(t.name);
      if (!ref) throw new FormulaError(`Catégorie inconnue : « ${t.name} ».`);
      return ref;
    }
    if (t.kind === 'op' && t.value === '-') return { type: 'neg', expr: primary() };
    if (t.kind === 'lp') {
      const e = sum();
      const close = tokens[pos++];
      if (!close || close.kind !== 'rp') throw new FormulaError('Parenthèse fermante manquante.');
      return e;
    }
    throw new FormulaError('Opérateur mal placé.');
  };
  const product = (): Expr => {
    let left = primary();
    for (let t = peek(); t && t.kind === 'op' && (t.value === '*' || t.value === '/'); t = peek()) {
      pos++;
      left = { type: 'op', op: t.value, left, right: primary() };
    }
    return left;
  };
  const sum = (): Expr => {
    let left = product();
    for (let t = peek(); t && t.kind === 'op' && (t.value === '+' || t.value === '-'); t = peek()) {
      pos++;
      left = { type: 'op', op: t.value, left, right: product() };
    }
    return left;
  };

  const expr = sum();
  if (pos < tokens.length) {
    throw new FormulaError(tokens[pos]!.kind === 'rp' ? 'Parenthèse fermante en trop.' : 'Formule mal formée.');
  }
  return expr;
}

/** Évalue une expression ; renvoie `null` en cas de division par zéro (« — »). */
export function evaluate(expr: Expr, value: (ref: Expr) => number): number | null {
  switch (expr.type) {
    case 'number':
      return expr.value;
    case 'category':
    case 'line':
      return value(expr);
    case 'neg': {
      const v = evaluate(expr.expr, value);
      return v === null ? null : -v;
    }
    case 'op': {
      const l = evaluate(expr.left, value);
      const r = evaluate(expr.right, value);
      if (l === null || r === null) return null;
      if (expr.op === '+') return l + r;
      if (expr.op === '-') return l - r;
      if (expr.op === '*') return l * r;
      return r === 0 ? null : l / r;
    }
  }
}

/**
 * Valeur d'un indicateur pour un mois et un scénario du plan : chaque
 * catégorie vaut sa prévision si le mois est courant ou futur, son réalisé
 * sinon ; une référence inconnue vaut 0.
 */
export function indicatorValue(expr: Expr, plan: PlanResult, scenarioId: string, month: MonthKey): number | null {
  const sp = plan.scenarios[scenarioId];
  if (!sp) return null;
  const future = month >= plan.currentMonth;
  return evaluate(expr, (ref) => {
    if (ref.type === 'category') {
      const cell = sp.rows[ref.id]?.[month];
      if (!cell) return 0;
      return future ? cell.forecast : cell.actual;
    }
    if (ref.type === 'line') {
      if (ref.line === 'closing') return sp.closing[month] ?? 0;
      const t = sp.totals[ref.line][month];
      if (!t) return 0;
      return future ? t.forecast : t.actual;
    }
    return 0;
  });
}

/** Formule lisible (pour les tableaux et l'éditeur). */
export function formatFormula(expr: Expr, nameOf: (ref: Expr) => string, parentPrec = 0): string {
  const prec = (e: Expr) => (e.type === 'op' ? (e.op === '+' || e.op === '-' ? 1 : 2) : 3);
  switch (expr.type) {
    case 'number':
      return String(expr.value).replace('.', ',');
    case 'category':
    case 'line':
      return `[${nameOf(expr)}]`;
    case 'neg':
      return `-${formatFormula(expr.expr, nameOf, 3)}`;
    case 'op': {
      const p = prec(expr);
      const sym = { '+': '+', '-': '−', '*': '×', '/': '÷' }[expr.op];
      const s = `${formatFormula(expr.left, nameOf, p)} ${sym} ${formatFormula(expr.right, nameOf, p + 1)}`;
      return p < parentPrec ? `(${s})` : s;
    }
  }
}

/** Lignes du plan utilisables dans une formule, en plus des catégories. */
export const INDICATOR_LINES: { name: string; line: 'in' | 'out' | 'closing' }[] = [
  { name: 'Encaissements', line: 'in' },
  { name: 'Décaissements', line: 'out' },
  { name: 'Solde fin', line: 'closing' },
];

const norm = (s: string) => s.trim().toLocaleLowerCase('fr');

/** Résolution d'un nom entre crochets : ligne du plan ou catégorie (insensible à la casse). */
export function indicatorResolver(categories: { id: string; name: string }[]): (name: string) => Expr | null {
  const byName = new Map(categories.map((c) => [norm(c.name), c.id]));
  const lines = new Map(INDICATOR_LINES.map((l) => [norm(l.name), l.line]));
  return (name) => {
    const n = norm(name);
    const line = lines.get(n);
    if (line) return { type: 'line', line };
    const id = byName.get(n);
    return id ? { type: 'category', id } : null;
  };
}

export type IndicatorFormat = 'number' | 'currency' | 'percent';

export interface IndicatorTemplate {
  key: string;
  name: string;
  formula: string;
  unit: string;
  format: IndicatorFormat;
  description: string;
}

/**
 * Modèles prêts à l'emploi (5.6), construits à partir de la nature des
 * catégories racines : ventes, achats, salaires, frais généraux. Un modèle
 * n'est proposé que si les catégories nécessaires existent.
 */
export function indicatorTemplates(
  categories: { id: string; name: string; kind: string; parentId: string | null; isVat?: boolean }[],
): IndicatorTemplate[] {
  const refs = (kind: string) => {
    const list = categories.filter((c) => c.kind === kind && !c.isVat);
    // Les plus hautes catégories de cette nature : leurs sous-catégories sont déjà incluses.
    const chosen = list.filter((c) => !list.some((p) => p.id === c.parentId));
    if (!chosen.length) return null;
    const s = chosen.map((c) => `[${c.name}]`).join(' + ');
    return chosen.length > 1 ? `(${s})` : s;
  };
  const sales = refs('revenue');
  const purchases = refs('purchases');
  const payroll = refs('payroll');
  const overheads = refs('overheads');
  const out: IndicatorTemplate[] = [];
  if (sales && purchases) {
    out.push({
      key: 'gross-margin',
      name: 'Marge brute',
      formula: `(${sales} - ${purchases}) / ${sales} * 100`,
      unit: '%',
      format: 'percent',
      description: 'Part des ventes qui reste après les achats.',
    });
    out.push({
      key: 'purchases-rate',
      name: "Taux d'achats consommés",
      formula: `${purchases} / 1,2 / (${sales} / 1,2) * 100`,
      unit: '%',
      format: 'percent',
      description: 'Achats hors taxes rapportés aux ventes hors taxes.',
    });
  }
  if (sales && payroll) {
    out.push({
      key: 'payroll-weight',
      name: 'Poids de la masse salariale',
      formula: `${payroll} / (${sales} / 1,2) * 100`,
      unit: '%',
      format: 'percent',
      description: 'Salaires et charges sociales rapportés au chiffre d’affaires HT.',
    });
  }
  if (sales && overheads) {
    out.push({
      key: 'overheads-ratio',
      name: 'Frais généraux / CA',
      formula: `${overheads} / ${sales} * 100`,
      unit: '%',
      format: 'percent',
      description: 'Poids des frais de fonctionnement dans les ventes.',
    });
  }
  out.push({
    key: 'net-flow',
    name: 'Flux net du mois',
    formula: '[Encaissements] - [Décaissements]',
    unit: '€',
    format: 'currency',
    description: 'Ce qui entre moins ce qui sort, mois par mois.',
  });
  return out;
}

/** Valeur formatée d'un indicateur : « 26,96 % », « 1 250 € », « — ». */
export function formatIndicator(value: number | null, unit: string, decimals = 2): string {
  if (value === null || !Number.isFinite(value)) return '—';
  const s = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(value);
  return unit ? `${s} ${unit}` : s;
}
