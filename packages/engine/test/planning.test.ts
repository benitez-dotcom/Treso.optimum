import { describe, expect, it } from 'vitest';
import {
  buildForecast,
  compareScenarios,
  computePlan,
  computeVatSchedule,
  eventAmounts,
  fillRight,
  gridToClipboard,
  historyAverages,
  increaseUntil,
  loanInstallment,
  monthRange,
  parseCellInput,
  parsePastedGrid,
  pasteToBudgets,
  PERIOD_TOO_LONG,
  periodMonths,
  presetPeriod,
  repeatBudget,
  validatePeriod,
  vatBudgets,
  type Budget,
} from '../src';
import { cat, inv, scenarios, tx } from './fixtures';

describe('saisie d’une cellule', () => {
  it('lit les montants à la française', () => {
    expect(parseCellInput('8 500')).toEqual({ ok: true, value: 8500 });
    expect(parseCellInput('8 500,50 €')).toEqual({ ok: true, value: 8500.5 });
    expect(parseCellInput('1.234,56')).toEqual({ ok: true, value: 1234.56 });
  });
  it('vide ou tiret = effacer (héritage du scénario de base)', () => {
    expect(parseCellInput('')).toEqual({ ok: true, value: null });
    expect(parseCellInput('—')).toEqual({ ok: true, value: null });
  });
  it('calcule les formules simples', () => {
    expect(parseCellInput('=8500*1,05')).toEqual({ ok: true, value: 8925 });
    expect(parseCellInput('=(1 200+300)*3')).toEqual({ ok: true, value: 4500 });
    expect(parseCellInput('=10000/3')).toEqual({ ok: true, value: 3333.33 });
  });
  it('refuse le négatif, le texte et les formules cassées', () => {
    expect(parseCellInput('-200')).toEqual({ ok: false, error: 'Un budget ne peut pas être négatif.' });
    expect(parseCellInput('abc').ok).toBe(false);
    expect(parseCellInput('=(2+3')).toEqual({ ok: false, error: 'Parenthèse fermante manquante.' });
    expect(parseCellInput('=5/0')).toEqual({ ok: false, error: 'Division par zéro.' });
  });
});

describe('collage depuis Excel (critère : plage 12 × 20)', () => {
  const months = monthRange('2027-01-01', 12);
  const rowIds = Array.from({ length: 20 }, (_, i) => `c${i}`);

  it('colle une plage de 12 mois × 20 catégories', () => {
    const text = rowIds.map((_, r) => months.map((_, m) => `${(r + 1) * 100 + m} €`).join('\t')).join('\r\n') + '\r\n';
    const grid = parsePastedGrid(text);
    expect(grid).toHaveLength(20);
    expect(grid[0]).toHaveLength(12);
    const res = pasteToBudgets(grid, { scenarioId: 'base', rowIds, months, startRow: 0, startMonth: 0 });
    expect(res.changes).toHaveLength(240);
    expect(res.skipped).toBe(0);
    expect(res.changes[0]).toEqual({ scenarioId: 'base', categoryId: 'c0', month: '2027-01-01', amount: 100 });
    expect(res.changes[239]).toEqual({ scenarioId: 'base', categoryId: 'c19', month: '2027-12-01', amount: 2011 });
  });

  it('formats Excel : milliers, négatifs, vides, cellules illisibles', () => {
    const grid = parsePastedGrid('1 234,50\t-800\t\tn/a');
    expect(grid).toEqual([[1234.5, 800, null, { invalid: 'n/a' }]]);
  });

  it('ignore ce qui déborde de la grille ou est verrouillé', () => {
    const grid = parsePastedGrid('1\t2\t3\n4\t5\t6');
    const res = pasteToBudgets(grid, {
      scenarioId: 'base',
      rowIds: ['a', 'b'],
      months: ['2027-01-01', '2027-02-01'],
      startRow: 1,
      startMonth: 0,
      canEdit: (_, m) => m !== '2027-01-01',
    });
    expect(res.changes).toEqual([{ scenarioId: 'base', categoryId: 'b', month: '2027-02-01', amount: 2 }]);
    expect(res.skipped).toBe(5);
  });

  it('copie vers Excel au format français', () => {
    expect(gridToClipboard([[8500.5, null], [12, 3]])).toBe('8500,5\t\n12\t3');
  });
});

describe('5.7 — répéter, recopier, augmenter', () => {
  it('répéter tous les 3 mois pendant 12 mois', () => {
    const b = repeatBudget('base', 'loyer', '2027-01-01', 900, 3, 12);
    expect(b.map((x) => x.month)).toEqual(['2027-01-01', '2027-04-01', '2027-07-01', '2027-10-01']);
  });
  it('la poignée de recopie copie la valeur sur les mois suivants', () => {
    const months = monthRange('2027-01-01', 6);
    expect(fillRight('base', 'loyer', months, '2027-02-01', '2027-04-01', 900).map((b) => b.month)).toEqual(['2027-03-01', '2027-04-01']);
  });
  it('augmenter de 5 % jusqu’à la fin de la période', () => {
    const months = monthRange('2027-01-01', 4);
    const values: Record<string, number> = { '2027-01-01': 1000, '2027-02-01': 1000, '2027-03-01': 2000, '2027-04-01': 0 };
    const b = increaseUntil('base', 'ventes', months, '2027-02-01', 5, (m) => values[m]!);
    expect(b.map((x) => [x.month, x.amount])).toEqual([
      ['2027-02-01', 1050],
      ['2027-03-01', 2100],
      ['2027-04-01', 0],
    ]);
  });
});

describe('période affichée et cumul', () => {
  it('préréglages', () => {
    expect(presetPeriod('rolling', '2026-11-01')).toEqual({ from: '2026-09-01', to: '2027-08-01' });
    expect(presetPeriod('calendar', '2026-11-01')).toEqual({ from: '2026-01-01', to: '2026-12-01' });
    expect(presetPeriod('fiscal', '2026-11-01', 7)).toEqual({ from: '2026-07-01', to: '2027-06-01' });
    expect(presetPeriod('fiscal', '2026-03-01', 7)).toEqual({ from: '2025-07-01', to: '2026-06-01' });
  });
  it('24 mois maximum', () => {
    expect(validatePeriod({ from: '2026-01-01', to: '2027-12-01' })).toBeNull();
    expect(validatePeriod({ from: '2026-01-01', to: '2028-01-01' })).toBe(PERIOD_TOO_LONG);
    expect(validatePeriod({ from: '2026-05-01', to: '2026-01-01' })).not.toBeNull();
    expect(periodMonths({ from: '2026-11-01', to: '2027-01-01' })).toHaveLength(3);
  });
});

describe('assistant prévisionnel', () => {
  const categories = [cat('ventes', 'in'), cat('loyer', 'out'), cat('salaires', 'out'), cat('charges', 'out'), cat('emprunt', 'in'), cat('remb', 'out')];
  const history = [
    tx('2026-08-10', 10_000, 'ventes'),
    tx('2026-09-10', 11_000, 'ventes'),
    tx('2026-10-10', 30_000, 'ventes'), // mois exceptionnel
    tx('2026-08-05', -1_200, 'loyer'),
    tx('2026-09-05', -1_200, 'loyer'),
    tx('2026-10-05', -1_200, 'loyer'),
    tx('2026-10-15', -999, 'loyer', { hidden: true }),
    tx('2026-11-02', -5_000, 'loyer'), // mois courant : ignoré
  ];

  it('moyenne des 3 derniers mois complets', () => {
    const avg = historyAverages(categories, history, '2026-11-01', 3);
    expect(avg.find((a) => a.categoryId === 'ventes')!.average).toBe(17_000);
    expect(avg.find((a) => a.categoryId === 'loyer')!.average).toBe(1_200);
  });

  it('exclure les mois exceptionnels', () => {
    const avg = historyAverages(categories, history, '2026-11-01', 3, { excludeExceptional: true });
    const ventes = avg.find((a) => a.categoryId === 'ventes')!;
    expect(ventes.average).toBe(10_500);
    expect(ventes.monthly.filter((m) => m.excluded).map((m) => m.month)).toEqual(['2026-10-01']);
  });

  it('mensualité d’emprunt à taux fixe', () => {
    expect(loanInstallment(12_000, 0, 12)).toBe(1000);
    expect(loanInstallment(50_000, 4.5, 60)).toBe(932.15);
  });

  it('événements : recrutement, emprunt', () => {
    const months = monthRange('2027-01-01', 6);
    const hire = eventAmounts(
      { type: 'hire', label: 'Commercial', month: '2027-03-01', grossMonthlySalary: 3000, employerChargesRate: 45, salaryCategoryId: 'salaires', chargesCategoryId: 'charges' },
      months,
    );
    expect(hire).toHaveLength(8);
    expect(hire.find((h) => h.categoryId === 'charges')!.amount).toBe(1350);
    const loan = eventAmounts(
      { type: 'loan', label: 'Prêt', month: '2027-01-01', amount: 12_000, annualRate: 0, durationMonths: 12, inflowCategoryId: 'emprunt', repaymentCategoryId: 'remb' },
      months,
    );
    expect(loan[0]).toEqual({ categoryId: 'emprunt', month: '2027-01-01', amount: 12_000 });
    expect(loan.filter((l) => l.categoryId === 'remb')).toHaveLength(5);
  });

  it('croissance par sens et événements cumulés', () => {
    const months = monthRange('2027-01-01', 2);
    const budgets = buildForecast(
      {
        baseline: new Map([['ventes', 10_000], ['loyer', 1_200]]),
        growthIn: 10,
        growthOut: 0,
        events: [{ type: 'investment', label: 'Machine', month: '2027-02-01', amount: 8_000, categoryId: 'loyer' }],
      },
      categories,
      months,
      'base',
    );
    const get = (c: string, m: string) => budgets.find((b) => b.categoryId === c && b.month === m)?.amount;
    expect(get('ventes', '2027-01-01')).toBe(11_000);
    expect(get('loyer', '2027-01-01')).toBe(1_200);
    expect(get('loyer', '2027-02-01')).toBe(9_200);
  });
});

describe('comparaison de scénarios', () => {
  it('solde de fin par scénario et écart à la base', () => {
    const months = monthRange('2026-12-01', 2);
    const budgets: Budget[] = [
      { scenarioId: 'base', categoryId: 'ventes', month: '2026-12-01', amount: 5000 },
      { scenarioId: 'base', categoryId: 'ventes', month: '2027-01-01', amount: 5000 },
      { scenarioId: 'alt', categoryId: 'ventes', month: '2027-01-01', amount: 3000 },
    ];
    const plan = computePlan({
      categories: [cat('ventes', 'in')],
      transactions: [],
      commitments: [],
      budgets,
      scenarios,
      months,
      today: '2026-11-06',
      mode: 'budget',
      openingBalance: 1000,
    });
    const rows = compareScenarios(plan, ['base', 'alt']);
    expect(rows[0]).toEqual({ month: '2026-12-01', closing: { base: 6000, alt: 6000 }, gap: { base: 0, alt: 0 } });
    expect(rows[1]).toEqual({ month: '2027-01-01', closing: { base: 11000, alt: 9000 }, gap: { base: 0, alt: -2000 } });
  });
});

describe('factures en retard : marqueur horloge', () => {
  it('signale le montant reporté au mois courant', () => {
    const plan = computePlan({
      categories: [cat('ventes', 'in')],
      transactions: [],
      commitments: [inv('2026-09-20', 1200, 'ventes'), inv('2026-12-20', 500, 'ventes')],
      budgets: [],
      scenarios,
      months: monthRange('2026-10-01', 3),
      today: '2026-11-06',
      mode: 'projection',
      openingBalance: 0,
    });
    expect(plan.overdue).toEqual({ ventes: { '2026-11-01': 1200 } });
  });
});

describe('5.8 — TVA écrite en budgets', () => {
  it('trimestrielle : versée le mois suivant la fin du trimestre', () => {
    const categories = [cat('ventes', 'in'), cat('tva', 'out', null, { isVat: true, vatRate: 0 })];
    const months = monthRange('2027-01-01', 6);
    const schedule = computeVatSchedule(categories, months, 'quarterly', (c) => (c === 'ventes' ? 1200 : 0));
    const b = vatBudgets('base', 'tva', months, schedule);
    expect(b.find((x) => x.month === '2027-04-01')!.amount).toBe(600);
    expect(b.find((x) => x.month === '2027-02-01')!.amount).toBeNull();
  });
});

describe('5.6 — modèles d’indicateurs', () => {
  it('construit les modèles à partir de la nature des catégories', async () => {
    const { indicatorTemplates, indicatorResolver, parseFormula, formatIndicator } = await import('../src');
    const categories = [
      cat('Ventes', 'in', null, { kind: 'revenue' }),
      cat('Achats', 'out', null, { kind: 'purchases' }),
      cat('RH', 'out', null, { kind: 'payroll' }),
      cat('Salaires', 'out', 'RH', { kind: 'payroll' }),
    ];
    const t = indicatorTemplates(categories);
    expect(t.map((x) => x.key)).toEqual(['gross-margin', 'purchases-rate', 'payroll-weight', 'net-flow']);
    expect(t[0]!.formula).toBe('([Ventes] - [Achats]) / [Ventes] * 100');
    expect(t[2]!.formula).toBe('[RH] / ([Ventes] / 1,2) * 100');
    for (const x of t) expect(() => parseFormula(x.formula, indicatorResolver(categories))).not.toThrow();
    expect(formatIndicator(26.9634, '%')).toBe('26,96 %');
    expect(formatIndicator(null, '%')).toBe('—');
  });
});
