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
