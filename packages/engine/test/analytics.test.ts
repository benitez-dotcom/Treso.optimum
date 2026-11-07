import { describe, expect, it } from 'vitest';
import {
  analysisKpis,
  breakdownByCategory,
  budgetsSheet,
  budgetVsActual,
  computePlan,
  invoicesSheet,
  last12Months,
  monthRange,
  parseBudgetSheet,
  parseMonthHeader,
  planSheet,
  previousPeriod,
  sheetName,
  sheetToCsv,
  topCounterparties,
  upsertBudgets,
  type Budget,
  type ExportContext,
} from '../src';
import { cat, inv, scenarios, tx } from './fixtures';

/** Jeu de test : une petite entreprise sur 3 mois. */
const categories = [
  cat('ventes', 'in', null, { name: 'Ventes', kind: 'revenue' }),
  cat('achats', 'out', null, { name: 'Achats', kind: 'purchases' }),
  cat('rh', 'out', null, { name: 'Personnel', kind: 'payroll' }),
  cat('salaires', 'out', 'rh', { name: 'Salaires' }),
  cat('loyer', 'out', null, { name: 'Loyer', kind: 'overheads' }),
];
const today = '2026-11-06';
const transactions = [
  tx('2026-09-05', 10_000, 'ventes', { counterparty: 'Studio Lumen' }),
  tx('2026-09-10', -2_000, 'achats', { counterparty: 'Bois SA' }),
  tx('2026-09-28', -3_000, 'salaires'),
  tx('2026-10-05', 6_000, 'ventes', { counterparty: 'Hôtel des Pins' }),
  tx('2026-10-06', 4_000, 'ventes', { counterparty: 'studio lumen' }),
  tx('2026-10-10', -2_000, 'achats', { counterparty: 'Bois SA' }),
  tx('2026-10-12', -1_000, 'loyer'),
  tx('2026-10-28', -3_000, 'salaires'),
  tx('2026-10-29', -500, null),
  tx('2026-11-02', -1_000, 'loyer', { hidden: true }),
];
const period = { from: '2026-09-01', to: '2026-10-31' };

describe('5.9 — KPI de la page Analyses', () => {
  const commitments = [
    inv('2026-10-01', 4_000, 'ventes', 'in', { status: 'paid', paidAt: '2026-10-06', counterparty: 'Studio Lumen' }),
    inv('2026-10-20', 1_000, 'ventes', 'in', { counterparty: 'Hôtel des Pins' }),
    inv('2026-10-15', 2_000, 'achats', 'out', { status: 'paid', paidAt: '2026-10-10' }),
  ];
  const k = analysisKpis({ categories, transactions, commitments, balance: 20_000, today, threshold: 15_000, period });

  it('ratios sur le réalisé', () => {
    expect(k.purchasesOnRevenue).toBe(20);
    expect(k.payrollOnRevenue).toBe(30);
    expect(k.overheadsOnRevenue).toBe(5);
    expect(k.variableChargesShare).toBe(36.36); // 4 000 / 11 000
  });

  it('délais moyens : payée en retard + échue non payée', () => {
    expect(k.customerDelay).toBe(11); // (5 + 17) / 2
    expect(k.supplierDelay).toBe(-5);
  });

  it('soldes quotidiens, jours sous zéro et sous le seuil', () => {
    // Solde le 31/10 = 20 000 (aujourd'hui) − 0 (opération du 2/11 exclue mais comptée dans le solde : −1 000) → 21 000
    expect(k.daysBelowZero).toBe(0);
    expect(k.daysBelowThreshold).toBeGreaterThan(0);
    expect(k.averageBalance).toBeGreaterThan(10_000);
    expect(k.autonomyMonths).not.toBeNull();
  });

  it('non calculable sans nature de catégorie', () => {
    const plain = categories.map((c) => ({ ...c, kind: 'none' as const }));
    const r = analysisKpis({ categories: plain, transactions, commitments: [], balance: 0, today, threshold: 0, period });
    expect(r.purchasesOnRevenue).toBeNull();
    expect(r.customerDelay).toBeNull();
  });

  it('périodes', () => {
    expect(previousPeriod(period)).toEqual({ from: '2026-07-02', to: '2026-08-31' });
    expect(last12Months(today)).toEqual({ from: '2025-12-01', to: today });
  });
});

describe('où va l’argent, tiers', () => {
  it('décaissements par catégorie racine, dépliables', () => {
    const b = breakdownByCategory(categories, transactions, 'out', period);
    expect(b.total).toBe(11_500);
    expect(b.rows.map((r) => [r.name, r.amount])).toEqual([
      ['Personnel', 6000],
      ['Achats', 4000],
      ['Loyer', 1000],
      ['À catégoriser', 500],
    ]);
    expect(b.rows[0]!.children[0]).toMatchObject({ name: 'Salaires', amount: 6000, share: 52.17 });
  });

  it('top clients et concentration', () => {
    const t = topCounterparties(transactions, [], 'in', period, today);
    expect(t.rows[0]).toMatchObject({ name: 'Studio Lumen', amount: 14_000, count: 2, share: 70 });
    expect(t.top3Share).toBe(100);
  });
});

describe('prévu vs réalisé', () => {
  it('écart par catégorie trié par écart absolu', () => {
    const budgets: Budget[] = [
      { scenarioId: 'base', categoryId: 'ventes', month: '2026-10-01', amount: 8_000 },
      { scenarioId: 'base', categoryId: 'loyer', month: '2026-10-01', amount: 1_000 },
    ];
    const plan = computePlan({ categories, transactions, commitments: [], budgets, scenarios, months: ['2026-10-01'], today, mode: 'budget', openingBalance: 0 });
    const rows = budgetVsActual(plan, 'base', categories, ['2026-10-01']);
    expect(rows.map((r) => r.categoryId)).toEqual(['ventes', 'loyer']);
    expect(rows.find((r) => r.categoryId === 'ventes')).toMatchObject({ planned: 8000, actual: 10_000, gap: 2000, gapPct: 25 });
    expect(rows.find((r) => r.categoryId === 'loyer')).toMatchObject({ gap: 0 });
  });
});

describe('exports', () => {
  const months = monthRange('2026-11-01', 3);
  const ctx: ExportContext = { companyName: 'Atelier', categories, accounts: [], scenarios, today, months, from: '2026-11-01', to: '2027-01-31' };

  it('noms d’onglets valides et uniques', () => {
    const taken = new Set<string>();
    expect(sheetName('Plan de trésorerie · Recrutement / mars 2027 [v2]', taken)).toBe('Plan de trésorerie · Recrutemen');
    expect(sheetName('Plan de trésorerie · Recrutement / mars 2027 [v2]', taken)).toBe('Plan de trésorerie · Recrut (2)');
  });

  it('plan : une ligne par catégorie, solde de fin', () => {
    const plan = computePlan({ categories, transactions, commitments: [], budgets: [], scenarios, months, today, mode: 'budget', openingBalance: 1000 });
    const s = planSheet(plan, scenarios[0]!, ctx);
    expect(s.columns).toHaveLength(5);
    expect(s.rows.map((r) => String(r[0]).trim())).toEqual([
      'Solde en début de mois', 'Encaissements', 'Ventes', 'Décaissements', 'Achats', 'Loyer', 'Personnel', 'Salaires', 'Variation du mois', 'Solde en fin de mois',
    ]);
  });

  it('CSV à la française', () => {
    const csv = sheetToCsv({ columns: [{ header: 'Date', type: 'date' }, { header: '2026-11-01', type: 'month' }, { header: 'Libellé', type: 'text' }], rows: [['2026-11-05', 1234.5, 'Loyer; atelier']] });
    expect(csv).toBe('﻿Date;11/2026;Libellé\r\n05/11/2026;1234,5;"Loyer; atelier"\r\n');
  });

  it('factures en retard seulement', () => {
    const c = [inv('2026-10-01', 100, 'ventes'), inv('2026-12-01', 200, 'ventes'), inv('2026-10-01', 50, 'achats', 'out')];
    expect(invoicesSheet(c, ctx, 'in', 'overdue').rows).toHaveLength(1);
    expect(invoicesSheet(c, ctx, 'both', 'all').rows).toHaveLength(1);
  });
});

describe('budgets : aller-retour export → import sans perte', () => {
  const months = monthRange('2027-01-01', 12);
  const ctx: ExportContext = { companyName: 'Atelier', categories, accounts: [], scenarios, today, months, from: '2027-01-01', to: '2027-12-31' };
  const budgets: Budget[] = [
    { scenarioId: 'base', categoryId: 'ventes', month: '2027-01-01', amount: 12_500.5 },
    { scenarioId: 'base', categoryId: 'ventes', month: '2027-06-01', amount: 0 },
    { scenarioId: 'base', categoryId: 'salaires', month: '2027-03-01', amount: 3_000 },
    { scenarioId: 'base', categoryId: 'loyer', month: '2027-12-01', amount: 1_850 },
    { scenarioId: 'alt', categoryId: 'loyer', month: '2027-12-01', amount: 999 },
  ];

  it('le fichier réimporté redonne exactement les mêmes budgets', () => {
    const sheet = budgetsSheet(budgets, scenarios[0]!, ctx);
    // Simule la relecture d'un XLSX : en-têtes de mois en Date, montants en nombres
    const matrix: unknown[][] = [
      sheet.columns.map((c) => (c.type === 'month' ? new Date(`${c.header}T00:00:00Z`) : c.header)),
      ...sheet.rows,
    ];
    const res = parseBudgetSheet(matrix, categories, 'base');
    expect(res.errors).toEqual([]);
    expect(res.unknownCategories).toEqual([]);
    expect(res.months).toEqual(months);
    const after = upsertBudgets(budgets.filter((b) => b.scenarioId !== 'base'), res.changes);
    const key = (b: Budget) => `${b.scenarioId}|${b.categoryId}|${b.month}|${b.amount}`;
    expect(after.map(key).sort()).toEqual(budgets.map(key).sort());
  });

  it('en-têtes de mois et tableaux maison', () => {
    expect(parseMonthHeader('janv. 2027')).toBe('2027-01-01');
    expect(parseMonthHeader('Février 2027')).toBe('2027-02-01');
    expect(parseMonthHeader('mars-27')).toBe('2027-03-01');
    expect(parseMonthHeader('juil 2027')).toBe('2027-07-01');
    expect(parseMonthHeader('06/2027')).toBe('2027-06-01');
    expect(parseMonthHeader('2027-09')).toBe('2027-09-01');
    expect(parseMonthHeader(new Date(Date.UTC(2027, 10, 1)))).toBe('2027-11-01');
    expect(parseMonthHeader('Total')).toBeNull();

    const res = parseBudgetSheet(
      [
        ['Budget 2027'],
        ['Poste', 'janv. 2027', 'févr. 2027', 'Total'],
        ['ventes', '10 000,00 €', '', 10000],
        ['Personnel', 1000, 1000],
        ['Publicité', 500],
        ['Loyer', 'abc'],
      ],
      categories,
      'base',
    );
    expect(res.changes).toEqual([{ scenarioId: 'base', categoryId: 'ventes', month: '2027-01-01', amount: 10_000 }]);
    expect(res.unknownCategories).toEqual(['Publicité']);
    expect(res.errors.map((e) => e.message)).toEqual([
      'Ligne 4 : « Personnel » se calcule à partir de ses sous-catégories.',
      'Ligne 6 : montant illisible « abc ».',
    ]);
  });
});
