import { describe, expect, it } from 'vitest';
import { computePlan, monthRange, openingBalanceAt, UNCATEGORIZED_OUT, type PlanInput } from '../src';
import { cat, inv, scenarios, tx } from './fixtures';

const months = monthRange('2026-10-01', 4); // oct (passé), nov (courant), déc, janv
const today = '2026-11-06';

const baseInput = (over: Partial<PlanInput> = {}): PlanInput => ({
  categories: [cat('ventes', 'in'), cat('loyer', 'out')],
  transactions: [],
  commitments: [],
  budgets: [],
  scenarios,
  months,
  today,
  mode: 'projection',
  openingBalance: 10_000,
  ...over,
});

describe('5.3 — prévision par catégorie (exemples normatifs)', () => {
  const input = baseInput({
    transactions: [tx('2026-11-03', 3324, 'ventes')],
    commitments: [inv('2026-12-15', 9000, 'ventes')],
    budgets: [
      { scenarioId: 'base', categoryId: 'ventes', month: '2026-11-01', amount: 8500 },
      { scenarioId: 'base', categoryId: 'ventes', month: '2026-12-01', amount: 8500 },
    ],
  });

  it('Projection, mois courant : réel 3 324, budget 8 500 → 8 500', () => {
    const p = computePlan(input);
    expect(p.scenarios.base!.rows.ventes!['2026-11-01']!.forecast).toBe(8500);
  });

  it('Projection, mois futur : budget 8 500, engagé 9 000 → 9 000', () => {
    const p = computePlan(input);
    expect(p.scenarios.base!.rows.ventes!['2026-12-01']!.forecast).toBe(9000);
  });

  it('Mode Budget, même cas → 8 500', () => {
    const p = computePlan({ ...input, mode: 'budget' });
    expect(p.scenarios.base!.rows.ventes!['2026-12-01']!.forecast).toBe(8500);
  });
});

describe('5.2 — scénarios calques', () => {
  const budgets = [
    { scenarioId: 'base', categoryId: 'loyer', month: '2026-12-01', amount: 1500 },
    { scenarioId: 'base', categoryId: 'loyer', month: '2027-01-01', amount: 1500 },
    { scenarioId: 'alt', categoryId: 'loyer', month: '2027-01-01', amount: 2000 },
  ];

  it('un scénario alternatif vide reprend les valeurs du scénario de base', () => {
    const p = computePlan(baseInput({ budgets }));
    const alt = p.scenarios.alt!.rows.loyer!;
    expect(alt['2026-12-01']!.forecast).toBe(1500);
    expect(alt['2026-12-01']!.isAlternative).toBe(false);
  });

  it('une valeur redéfinie est marquée alternative', () => {
    const p = computePlan(baseInput({ budgets }));
    const cell = p.scenarios.alt!.rows.loyer!['2027-01-01']!;
    expect(cell.forecast).toBe(2000);
    expect(cell.isAlternative).toBe(true);
    expect(p.scenarios.base!.rows.loyer!['2027-01-01']!.forecast).toBe(1500);
  });

  it('une valeur égale à la base n\'est pas alternative', () => {
    const p = computePlan(baseInput({ budgets: [...budgets, { scenarioId: 'alt', categoryId: 'loyer', month: '2026-12-01', amount: 1500 }] }));
    expect(p.scenarios.alt!.rows.loyer!['2026-12-01']!.isAlternative).toBe(false);
  });
});

describe('5.3 — budget global au niveau parent', () => {
  const categories = [
    cat('fg', 'out', null, { budgetAtParent: true }),
    cat('logiciels', 'out', 'fg'),
    cat('assurances', 'out', 'fg'),
  ];

  it('les enfants n\'ont pas de budget, le parent porte le budget', () => {
    const p = computePlan(baseInput({
      categories,
      commitments: [inv('2026-12-10', 700, 'logiciels', 'out'), inv('2026-12-20', 500, 'assurances', 'out')],
      budgets: [{ scenarioId: 'base', categoryId: 'fg', month: '2026-12-01', amount: 1000 }],
    }));
    const rows = p.scenarios.base!.rows;
    expect(rows.logiciels!['2026-12-01']!.budget).toBe(0);
    expect(rows.logiciels!['2026-12-01']!.forecast).toBe(700);
    expect(rows.fg!['2026-12-01']!.budget).toBe(1000);
    // Projection : max(700 + 500, 1000)
    expect(rows.fg!['2026-12-01']!.forecast).toBe(1200);
  });

  it('un parent normal additionne les prévisions de ses enfants', () => {
    const p = computePlan(baseInput({
      categories: [cat('rh', 'out'), cat('salaires', 'out', 'rh'), cat('urssaf', 'out', 'rh')],
      budgets: [
        { scenarioId: 'base', categoryId: 'salaires', month: '2026-12-01', amount: 6000 },
        { scenarioId: 'base', categoryId: 'urssaf', month: '2026-12-01', amount: 2500 },
      ],
    }));
    expect(p.scenarios.base!.rows.rh!['2026-12-01']!.forecast).toBe(8500);
    expect(p.scenarios.base!.rows.rh!['2026-12-01']!.editable).toBe(false);
  });
});

describe('5.4 — soldes enchaînés', () => {
  it('réel au passé, prévision au présent et au futur', () => {
    const p = computePlan(baseInput({
      transactions: [tx('2026-10-05', 5000, 'ventes'), tx('2026-10-06', -1500, 'loyer')],
      budgets: [
        { scenarioId: 'base', categoryId: 'ventes', month: '2026-11-01', amount: 6000 },
        { scenarioId: 'base', categoryId: 'loyer', month: '2026-11-01', amount: 1500 },
        { scenarioId: 'base', categoryId: 'loyer', month: '2026-12-01', amount: 1500 },
      ],
    }));
    const s = p.scenarios.base!;
    expect(s.opening['2026-10-01']).toBe(10_000);
    expect(s.closing['2026-10-01']).toBe(13_500);
    expect(s.opening['2026-11-01']).toBe(13_500);
    expect(s.closing['2026-11-01']).toBe(18_000);
    expect(s.closing['2026-12-01']).toBe(16_500);
    expect(s.variation['2026-12-01']).toBe(-1500);
  });

  it('les opérations exclues restent dans le solde mais pas dans les totaux', () => {
    const p = computePlan(baseInput({ transactions: [tx('2026-10-10', -800, 'loyer', { hidden: true })] }));
    const s = p.scenarios.base!;
    expect(s.totals.out['2026-10-01']!.actual).toBe(0);
    expect(s.hidden['2026-10-01']).toBe(-800);
    expect(s.closing['2026-10-01']).toBe(9_200);
  });

  it('les opérations non catégorisées alimentent la ligne « À catégoriser »', () => {
    const p = computePlan(baseInput({ transactions: [tx('2026-10-10', -250, null)] }));
    expect(p.scenarios.base!.rows[UNCATEGORIZED_OUT]!['2026-10-01']!.actual).toBe(250);
    expect(p.scenarios.base!.closing['2026-10-01']).toBe(9_750);
  });
});

describe('5.5 — factures en retard', () => {
  it('reportées au mois courant par défaut', () => {
    const p = computePlan(baseInput({ commitments: [inv('2026-10-20', 1200, 'ventes')] }));
    expect(p.scenarios.base!.rows.ventes!['2026-11-01']!.committed).toBe(1200);
    expect(p.scenarios.base!.rows.ventes!['2026-10-01']!.committed).toBe(0);
  });

  it('conservées dans le mois d\'échéance si demandé', () => {
    const p = computePlan(baseInput({ overdueInPlan: 'due_month', commitments: [inv('2026-10-20', 1200, 'ventes')] }));
    expect(p.scenarios.base!.rows.ventes!['2026-10-01']!.committed).toBe(1200);
  });

  it('un paiement partiel ne laisse que le reste à payer', () => {
    const p = computePlan(baseInput({ commitments: [inv('2026-12-10', 1000, 'ventes', 'in', { amountPaid: 400 })] }));
    expect(p.scenarios.base!.rows.ventes!['2026-12-01']!.committed).toBe(600);
  });
});

describe('solde d\'ouverture', () => {
  it('reconstitue le solde au 1er du mois depuis le solde actuel', () => {
    const t = [tx('2026-10-15', 2000, 'ventes'), tx('2026-11-02', -500, 'loyer'), tx('2026-09-30', 999, 'ventes')];
    expect(openingBalanceAt('2026-10-01', 12_000, t, today)).toBe(10_500);
  });
});
