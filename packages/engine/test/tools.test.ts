import { describe, expect, it } from 'vitest';
import {
  computePlan,
  computeVatSchedule,
  evaluate,
  findSimilar,
  formatFormula,
  formatPlanAmount,
  formatSigned,
  FormulaError,
  indicatorValue,
  monthRange,
  parseFormula,
  remainingToSplit,
  repeatMonths,
  splitEqually,
  suggestCategory,
  upsertBudgets,
  type Expr,
} from '../src';
import { cat, scenarios, tx } from './fixtures';

describe('division (7.6)', () => {
  it('258,20 en 2 → 130,00 + 128,20', () => {
    expect(splitEqually(258.2, 2)).toEqual([130, 128.2]);
  });
  it('fonctionne pour un décaissement', () => {
    expect(splitEqually(-100, 3)).toEqual([-34, -34, -32]);
  });
  it('reste à répartir', () => {
    expect(remainingToSplit(258.2, [130, 128.2])).toBe(0);
    expect(remainingToSplit(258.2, [130, 100])).toBe(28.2);
  });
});

describe('5.7 — répéter une valeur', () => {
  it('tous les 3 mois pendant 12 mois', () => {
    expect(repeatMonths('2026-12-01', 3, 12)).toEqual(['2026-12-01', '2027-03-01', '2027-06-01', '2027-09-01']);
  });
  it('chaque mois pendant 3 mois', () => {
    expect(repeatMonths('2026-11-01', 1, 3)).toEqual(['2026-11-01', '2026-12-01', '2027-01-01']);
  });
  it('refuse les bornes invalides', () => {
    expect(() => repeatMonths('2026-11-01', 0, 3)).toThrow();
    expect(() => repeatMonths('2026-11-01', 1, 37)).toThrow();
  });
  it('upsert remplace la valeur existante et supprime les null', () => {
    const b = upsertBudgets(
      [{ scenarioId: 's', categoryId: 'c', month: '2026-11-01', amount: 10 }],
      [{ scenarioId: 's', categoryId: 'c', month: '2026-11-01', amount: 20 }, { scenarioId: 's', categoryId: 'd', month: '2026-11-01', amount: null }],
    );
    expect(b).toEqual([{ scenarioId: 's', categoryId: 'c', month: '2026-11-01', amount: 20 }]);
  });
});

describe('5.6 — indicateurs personnalisés', () => {
  const resolve = (name: string): Expr | null =>
    name === 'Achats' ? { type: 'category', id: 'achats' } : name === 'Ventes' ? { type: 'category', id: 'ventes' } : null;

  it('Taux d\'achats consommés = Achats ÷ 1,2 ÷ (Ventes ÷ 1,1) × 100', () => {
    const e = parseFormula('[Achats] / 1,2 / ([Ventes] / 1,1) * 100', resolve);
    const v = evaluate(e, (r) => (r.type === 'category' && r.id === 'achats' ? 7200 : 22800));
    expect(v).toBeCloseTo(28.947, 2);
  });
  it('division par zéro → null (« — »)', () => {
    const e = parseFormula('[Achats] / [Ventes]', resolve);
    expect(evaluate(e, (r) => (r.type === 'category' && r.id === 'achats' ? 10 : 0))).toBeNull();
  });
  it('erreurs de syntaxe explicites', () => {
    expect(() => parseFormula('([Achats] / 2', resolve)).toThrow(FormulaError);
    expect(() => parseFormula('[Inconnue] * 2', resolve)).toThrow('Catégorie inconnue');
    expect(() => parseFormula('2 * * 3', resolve)).toThrow(FormulaError);
  });
  it('priorité des opérateurs et format lisible', () => {
    const e = parseFormula('1 + 2 × 3', resolve);
    expect(evaluate(e, () => 0)).toBe(7);
    expect(formatFormula(parseFormula('([Achats] + 1) * 2', resolve), (r) => (r.type === 'category' ? r.id : ''))).toBe('([achats] + 1) × 2');
  });
  it('utilise le réalisé au passé et la prévision au futur', () => {
    const months = monthRange('2026-10-01', 3);
    const plan = computePlan({
      categories: [cat('ventes', 'in')],
      transactions: [tx('2026-10-10', 1000, 'ventes')],
      commitments: [],
      budgets: [{ scenarioId: 'base', categoryId: 'ventes', month: '2026-12-01', amount: 3000 }],
      scenarios,
      months,
      today: '2026-11-06',
      mode: 'projection',
      openingBalance: 0,
    });
    const e: Expr = { type: 'op', op: '*', left: { type: 'category', id: 'ventes' }, right: { type: 'number', value: 2 } };
    expect(indicatorValue(e, plan, 'base', '2026-10-01')).toBe(2000);
    expect(indicatorValue(e, plan, 'base', '2026-12-01')).toBe(6000);
  });
});

describe('5.8 — TVA', () => {
  const categories = [cat('ventes', 'in', null, { vatRate: 20 }), cat('achats', 'out', null, { vatRate: 20 })];
  const months = monthRange('2026-10-01', 3);
  const forecast = (id: string) => (id === 'ventes' ? 12_000 : 6_000);

  it('régime mensuel : versement le mois suivant', () => {
    const s = computeVatSchedule(categories, months, 'monthly', forecast);
    expect(s[0]).toEqual({ month: '2026-11-01', due: 1000, creditAfter: 0 });
    expect(s).toHaveLength(3);
  });
  it('régime trimestriel : versement le mois suivant la fin du trimestre', () => {
    const s = computeVatSchedule(categories, months, 'quarterly', forecast);
    // octobre, novembre et décembre (T4) sont versés en janvier
    expect(s.map((l) => l.month)).toEqual(['2027-01-01']);
    expect(s[0]!.due).toBe(3000);
  });
  it('un solde négatif devient un crédit reporté', () => {
    const s = computeVatSchedule(categories, ['2026-10-01', '2026-11-01'], 'monthly', (id, m) =>
      id === 'ventes' ? (m === '2026-10-01' ? 1200 : 12_000) : 6000,
    );
    expect(s[0]).toEqual({ month: '2026-11-01', due: 0, creditAfter: 800 });
    expect(s[1]).toEqual({ month: '2026-12-01', due: 200, creditAfter: 0 });
  });
});

describe('5.10 — catégorisation assistée', () => {
  const history = [
    tx('2026-08-15', -2900, 'urssaf', { rawLabel: 'PRLV SEPA URSSAF 0826' }),
    tx('2026-09-15', -2950, 'urssaf', { rawLabel: 'PRLV SEPA URSSAF 0926' }),
    tx('2026-10-15', -2940, 'urssaf', { rawLabel: 'PRLV SEPA URSSAF 1026' }),
  ];
  const incoming = tx('2026-11-15', -2960, null, { rawLabel: 'PRLV SEPA URSSAF 1126' });

  it('suggère par similarité avec une confiance haute à 3 occurrences', () => {
    expect(suggestCategory(incoming, [], history)).toEqual({ categoryId: 'urssaf', source: 'similar', confidence: 'high' });
  });
  it('une règle l\'emporte sur la similarité', () => {
    const rules = [{ id: 'r', conditions: [{ field: 'label' as const, op: 'contains' as const, value: 'urssaf' }], categoryId: 'charges', autoApply: false, priority: 1 }];
    expect(suggestCategory(incoming, rules, history)?.source).toBe('rule');
  });
  it('trouve les opérations similaires non catégorisées', () => {
    const other = tx('2026-11-20', -100, null, { rawLabel: 'PRLV SEPA URSSAF 1226' });
    const unrelated = tx('2026-11-20', -100, null, { rawLabel: 'LOYER' });
    expect(findSimilar(incoming, [other, unrelated]).map((t) => t.id)).toEqual([other.id]);
  });
});

describe('formats', () => {
  it('montants du plan', () => {
    expect(formatPlanAmount(0)).toBe('—');
    expect(formatPlanAmount(8500.99).replace(/\s/g, ' ')).toBe('8 500');
    expect(formatSigned(-2600).replace(/\s/g, ' ')).toBe('−2 600');
    expect(formatSigned(6517).replace(/\s/g, ' ')).toBe('+6 517');
  });
});
