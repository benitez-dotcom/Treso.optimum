import { describe, expect, it } from 'vitest';
import {
  addMonthsToDate,
  bestMatches,
  checkReconciliation,
  computeAlerts,
  computePlan,
  counterpartyDefaults,
  dailyKpis,
  dailyProjection,
  dueFromTerms,
  findDuplicates,
  groupPoints,
  guessInvoiceMapping,
  invoiceAccount,
  invoiceStatus,
  missingInvoiceFields,
  monthRange,
  previewInvoiceImport,
  RECONCILIATION_EXCEEDED,
  reconciliationCandidates,
  reminderEmail,
  seriesDates,
  seriesTargets,
  termsFromDates,
  uncoveredFromPlan,
  weekStart,
  type Commitment,
  type Reconciliation,
} from '../src';
import { cat, inv, scenarios, tx } from './fixtures';

const today = '2026-11-07';

describe('délais et échéances', () => {
  it('calcule l’échéance depuis le délai et retrouve le délai depuis les dates', () => {
    expect(dueFromTerms('2026-11-07', 'on_receipt')).toBe('2026-11-07');
    expect(dueFromTerms('2026-11-07', 'd30')).toBe('2026-12-07');
    expect(dueFromTerms('2026-02-10', 'end_of_month')).toBe('2026-02-28');
    expect(dueFromTerms('2026-11-07', 'custom')).toBeNull();
    expect(termsFromDates('2026-11-07', '2026-12-22')).toBe('d45');
    expect(termsFromDates('2026-11-07', '2026-12-01')).toBe('custom');
  });
  it('ajoute des mois sans dériver en fin de mois', () => {
    expect(addMonthsToDate('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonthsToDate('2026-01-31', 2)).toBe('2026-03-31');
    expect(addMonthsToDate('2026-11-15', 3)).toBe('2027-02-15');
  });
});

describe('séries récurrentes (critère : série mensuelle de 12 = 12 échéances)', () => {
  it('12 échéances mensuelles', () => {
    const d = seriesDates('2026-11-30', 1, { count: 12 });
    expect(d).toHaveLength(12);
    expect(d[0]).toBe('2026-11-30');
    expect(d[3]).toBe('2027-02-28');
    expect(d[4]).toBe('2027-03-30');
    expect(d[11]).toBe('2027-10-30');
  });
  it('trimestrielle jusqu’à une date de fin, limites 1–120', () => {
    expect(seriesDates('2026-12-01', 3, { endDate: '2027-09-01' })).toEqual(['2026-12-01', '2027-03-01', '2027-06-01', '2027-09-01']);
    expect(() => seriesDates('2026-12-01', 1, { count: 121 })).toThrow();
    expect(seriesDates('2026-12-01', 1, {})).toHaveLength(120);
  });

  it('« cette échéance et les suivantes » épargne les échéances passées, payées ou remplacées', () => {
    const occ = (id: string, dueAt: string, extra: Partial<Commitment> = {}): Commitment =>
      inv(dueAt, 500, 'loyer', 'out', { id, seriesId: 's1', ...extra });
    const all = [
      occ('a', '2026-10-05'),
      occ('b', '2026-11-05'), // passée (aujourd'hui = 7 nov.)
      occ('c', '2026-12-05'),
      occ('d', '2027-01-05', { status: 'paid', amountPaid: 500 }),
      occ('e', '2027-02-05', { replacedBy: 'imp-1' }),
      occ('f', '2027-03-05', { amountPaid: 100 }),
      occ('g', '2027-04-05'),
      inv('2027-05-05', 500, 'loyer', 'out', { id: 'other' }),
    ];
    expect(seriesTargets(all, all[2]!, 'following', today).map((c) => c.id)).toEqual(['c', 'g']);
    expect(seriesTargets(all, all[1]!, 'following', today).map((c) => c.id)).toEqual(['b', 'c', 'g']);
    expect(seriesTargets(all, all[2]!, 'one', today).map((c) => c.id)).toEqual(['c']);
  });
});

describe('statut', () => {
  it('à venir, en retard (+ jours), partiellement payée, payée', () => {
    expect(invoiceStatus(inv('2026-12-01', 100, null), today)).toEqual({ status: 'upcoming', daysLate: 0 });
    expect(invoiceStatus(inv('2026-10-26', 100, null), today)).toEqual({ status: 'overdue', daysLate: 12 });
    expect(invoiceStatus(inv('2026-12-01', 100, null, 'in', { amountPaid: 40 }), today).status).toBe('partial');
    expect(invoiceStatus(inv('2026-12-01', 100, null, 'in', { amountPaid: 100 }), today).status).toBe('paid');
  });
});

describe('5.12 — compte en cascade', () => {
  const categories = [cat('fg', 'out', null, { defaultAccountId: 'acc-fg' }), cat('loyer', 'out', 'fg'), cat('achats', 'out', null, { defaultAccountId: 'acc-achats' }), cat('divers', 'out')];
  const ctx = (commitments: Commitment[] = [], defaultAccountId: string | null = 'acc-def') => ({ commitments, categories, defaultAccountId });
  it('facture → tiers → catégorie → parent → défaut', () => {
    expect(invoiceAccount({ id: 'x', accountId: 'acc-x', counterparty: 'A', categoryId: 'achats' }, ctx())).toEqual({ accountId: 'acc-x', source: 'invoice' });
    const sibling = inv('2026-10-01', 10, 'divers', 'out', { counterparty: 'Foncière Dupont', accountId: 'acc-tiers' });
    expect(invoiceAccount({ id: 'x', accountId: null, counterparty: 'FONCIERE DUPONT', categoryId: 'achats' }, ctx([sibling]))).toEqual({ accountId: 'acc-tiers', source: 'counterparty' });
    expect(invoiceAccount({ id: 'x', accountId: null, counterparty: 'B', categoryId: 'achats' }, ctx())).toEqual({ accountId: 'acc-achats', source: 'category' });
    expect(invoiceAccount({ id: 'x', accountId: null, counterparty: 'B', categoryId: 'loyer' }, ctx())).toEqual({ accountId: 'acc-fg', source: 'parent' });
    expect(invoiceAccount({ id: 'x', accountId: null, counterparty: 'B', categoryId: 'divers' }, ctx())).toEqual({ accountId: 'acc-def', source: 'default' });
    expect(invoiceAccount({ id: 'x', accountId: null, counterparty: 'B', categoryId: 'divers' }, ctx([], null)).source).toBe('none');
  });
  it('habitudes des tiers', () => {
    const list = [
      inv('2026-09-30', 100, 'achats', 'out', { counterparty: 'Bois & Co', issuedAt: '2026-09-01', vatRate: 20 }),
      inv('2026-10-31', 100, 'divers', 'out', { counterparty: 'Bois & Co', issuedAt: '2026-10-01', vatRate: 10 }),
    ];
    expect(counterpartyDefaults(list, 'out')[0]).toMatchObject({ name: 'Bois & Co', categoryId: 'divers', vatRate: 10, paymentTerms: 'd30', count: 2 });
  });
});

describe('5.11 — rapprochements', () => {
  const facture = inv('2026-11-05', 1200, 'ventes', 'in', { id: 'f1', number: 'FA-2026-112', counterparty: 'Studio Lumen' });
  const paiement = tx('2026-11-06', 1200, null, { id: 'p1', rawLabel: 'VIR SEPA STUDIO LUMEN FA2026112' });

  it('suggère avec un score (montant, numéro, tiers, date)', () => {
    const c = reconciliationCandidates([paiement, tx('2026-11-06', 55, null)], [facture], []);
    expect(c).toHaveLength(1);
    expect(c[0]!.score).toBe(100);
    expect(c[0]!.reasons).toEqual(['Montant identique', 'Numéro FA-2026-112', 'Même tiers', 'Date proche de l’échéance']);
    expect(c[0]!.amount).toBe(1200);
  });

  it('refuse un rapprochement supérieur au montant du paiement', () => {
    const autre = inv('2026-11-20', 900, 'ventes', 'in', { id: 'f2' });
    const recs: Reconciliation[] = [{ id: 'r1', transactionId: 'p1', commitmentId: 'f1', amount: 1000 }];
    expect(checkReconciliation(paiement, autre, 300, recs)).toBe(RECONCILIATION_EXCEEDED);
    expect(checkReconciliation(paiement, autre, 200, recs)).toBeNull();
    expect(checkReconciliation(paiement, inv('2026-11-20', 900, 'x', 'out'), 100, [])).not.toBeNull();
    expect(checkReconciliation(paiement, inv('2026-11-20', 100, 'ventes', 'in'), 150, [])).toBe('Ce montant dépasse le reste à payer de la facture.');
  });

  it('un paiement partiel laisse la facture ouverte pour le reste', () => {
    const partiel = tx('2026-11-06', 500, null, { id: 'p2', rawLabel: 'VIR STUDIO LUMEN' });
    const c = reconciliationCandidates([partiel], [facture], []);
    expect(c[0]!.amount).toBe(500);
    const after = { ...facture, amountPaid: 500 };
    expect(invoiceStatus(after, today).status).toBe('overdue');
    expect(reconciliationCandidates([paiement], [after], [], {})[0]!.amount).toBe(700);
  });

  it('une opération déjà entièrement rapprochée n’est plus proposée', () => {
    const recs: Reconciliation[] = [{ id: 'r', transactionId: 'p1', commitmentId: 'zz', amount: 1200 }];
    expect(reconciliationCandidates([paiement], [facture], recs)).toHaveLength(0);
    expect(bestMatches(reconciliationCandidates([paiement], [facture, { ...facture, id: 'f3' }], []))).toHaveLength(1);
  });
});

describe('doublons', () => {
  it('échéance récurrente manuelle ↔ facture importée', () => {
    const manual = inv('2026-12-05', 1850, 'loyer', 'out', { id: 'm', counterparty: 'Foncière Dupont', seriesId: 's', source: 'manual' });
    const imported = inv('2026-12-08', 1860, 'loyer', 'out', { id: 'i', counterparty: 'FONCIERE DUPONT', source: 'import' });
    const far = inv('2027-01-30', 1850, 'loyer', 'out', { id: 'j', counterparty: 'Foncière Dupont', source: 'import' });
    expect(findDuplicates([manual, imported, far]).map((p) => [p.manual.id, p.imported.id])).toEqual([['m', 'i']]);
    expect(findDuplicates([{ ...manual, replacedBy: 'i' }, imported])).toEqual([]);
  });
});

describe('import de factures', () => {
  const categories = [cat('ventes', 'in', null, { name: 'Ventes', vatRate: 20 } as never)];
  it('propose la correspondance et signale les champs manquants', () => {
    const m = guessInvoiceMapping(['Client', 'N° facture', 'Date', 'Échéance', 'Montant TTC', 'Catégorie']);
    expect(m).toEqual({ Client: 'counterparty', 'N° facture': 'number', Date: 'issuedAt', Échéance: 'dueAt', 'Montant TTC': 'amount', Catégorie: 'category' });
    expect(missingInvoiceFields({ A: 'label' })).toEqual(['Montant TTC', 'Échéance']);
  });
  it('lit les lignes, les erreurs, les doublons et les catégories inconnues', () => {
    const rows = [
      { Client: 'Studio Lumen', Num: 'FA-1', Echeance: '05/12/2026', Montant: '1 200,00', Cat: 'Ventes' },
      { Client: 'Hôtel des Pins', Num: 'FA-2', Echeance: '32/12/2026', Montant: '300', Cat: '' },
      { Client: 'Agence Boréal', Num: 'FA-3', Echeance: '10/12/2026', Montant: 'abc', Cat: '' },
      { Client: 'Studio Lumen', Num: 'FA-1', Echeance: '05/12/2026', Montant: '1200', Cat: 'Prestations' },
    ];
    const p = previewInvoiceImport(rows, { Client: 'counterparty', Num: 'number', Echeance: 'dueAt', Montant: 'amount', Cat: 'category' }, { flow: 'in', categories, existing: [], today });
    expect(p.rows).toHaveLength(2);
    expect(p.rows[0]).toMatchObject({ counterparty: 'Studio Lumen', amountInclTax: 1200, dueAt: '2026-12-05', issuedAt: today, categoryId: 'ventes', vatRate: 20 });
    expect(p.errors).toEqual([
      { line: 3, message: 'Date illisible ligne 3.' },
      { line: 4, message: 'Montant illisible ligne 4 : « abc ».' },
    ]);
    expect(p.duplicates).toEqual([5]);
    expect(p.unknownCategories).toEqual(['Prestations']);
  });
});

describe('relance', () => {
  it('email de relance en français', () => {
    const e = reminderEmail(inv('2026-10-20', 4850, 'ventes', 'in', { number: 'FA-2026-098' }), 'ALS Énergie', today);
    expect(e.subject).toBe('Relance : facture n° FA-2026-098 échue le 20/10/2026');
    expect(e.body).toContain('reste impayée depuis 18 jours');
    expect(e.body).toMatch(/4\s850,00\s€/);
    expect(e.body.endsWith('ALS Énergie')).toBe(true);
  });
});

describe('7.7 — au jour le jour', () => {
  const transactions = [tx('2026-11-02', -300, 'loyer'), tx('2026-11-06', 1000, 'ventes')];
  it('une facture en retard est comptée aujourd’hui ; la simulation de report déplace la courbe', () => {
    const late = inv('2026-10-15', 2000, 'ventes', 'in', { id: 'late' });
    const next = inv('2026-11-20', 500, 'loyer', 'out', { id: 'next' });
    const pts = dailyProjection({ from: '2026-11-01', to: '2026-11-30', today, currentBalance: 10_000, transactions, commitments: [late, next] });
    expect(pts[0]!.opening).toBe(9300);
    const day = (d: string) => pts.find((p) => p.date === d)!;
    expect(day(today).inPlanned).toBe(2000);
    expect(day(today).invoiceIds).toEqual(['late']);
    expect(day('2026-11-06').closing).toBe(10_000);
    expect(day('2026-11-30').closing).toBe(11_500);
    const k = dailyKpis(pts);
    expect(k).toMatchObject({ opening: 9300, closing: 11_500, variation: 2200, low: { date: '2026-11-02', value: 9000 } });

    const shifted = dailyProjection({ from: '2026-11-01', to: '2026-11-30', today, currentBalance: 10_000, transactions, commitments: [late, next], shifts: new Map([['late', '2026-11-25']]) });
    expect(shifted.find((p) => p.date === '2026-11-20')!.closing).toBe(9500);
  });

  it('budgets non couverts répartis sur les jours restants du mois', () => {
    const pts = dailyProjection({
      from: '2026-11-01',
      to: '2026-12-31',
      today,
      currentBalance: 0,
      transactions: [],
      commitments: [],
      uncovered: [
        { month: '2026-11-01', flow: 'out', amount: 2300 },
        { month: '2026-12-01', flow: 'in', amount: 3100 },
      ],
    });
    expect(pts.find((p) => p.date === '2026-11-07')!.outPlanned).toBe(0);
    expect(pts.find((p) => p.date === '2026-11-08')!.outPlanned).toBe(100);
    expect(pts.find((p) => p.date === '2026-12-01')!.inPlanned).toBe(100);
    expect(pts[pts.length - 1]!.closing).toBe(800);
  });

  it('regroupe par semaine (du lundi) et par mois', () => {
    expect(weekStart('2026-11-07')).toBe('2026-11-02');
    const pts = dailyProjection({ from: '2026-11-01', to: '2026-11-30', today, currentBalance: 10_000, transactions, commitments: [] });
    const weeks = groupPoints(pts, 'week');
    expect(weeks[0]).toMatchObject({ start: '2026-11-01', end: '2026-11-01' });
    expect(weeks[1]).toMatchObject({ start: '2026-11-02', end: '2026-11-08', outActual: 300, inActual: 1000 });
    expect(groupPoints(pts, 'month')).toHaveLength(1);
  });

  it('uncoveredFromPlan : prévision − réalisé − engagé', () => {
    const plan = computePlan({
      categories: [cat('ventes', 'in')],
      transactions: [tx('2026-11-03', 1000, 'ventes')],
      commitments: [inv('2026-11-20', 2000, 'ventes')],
      budgets: [{ scenarioId: 'base', categoryId: 'ventes', month: '2026-11-01', amount: 5000 }],
      scenarios,
      months: monthRange('2026-10-01', 2),
      today,
      mode: 'projection',
      openingBalance: 0,
    });
    expect(uncoveredFromPlan(plan, 'base')).toEqual([
      { month: '2026-11-01', flow: 'in', amount: 2000 },
      { month: '2026-11-01', flow: 'out', amount: 0 },
    ]);
  });
});

describe('5.13 — alertes (critère : alerte de seuil déclenchée)', () => {
  it('seuil, retards, dépassement de budget, synchronisation', () => {
    const projection = dailyProjection({
      from: today,
      to: '2027-01-06',
      today,
      currentBalance: 8000,
      transactions: [],
      commitments: [inv('2026-12-14', 4000, 'loyer', 'out')],
    });
    const plan = computePlan({
      categories: [cat('loyer', 'out', null, { name: 'Loyer' } as never)],
      transactions: [tx('2026-11-03', -2100, 'loyer')],
      commitments: [],
      budgets: [{ scenarioId: 'base', categoryId: 'loyer', month: '2026-11-01', amount: 1850 }],
      scenarios,
      months: monthRange('2026-11-01', 1),
      today,
      mode: 'projection',
      openingBalance: 0,
    });
    const alerts = computeAlerts({
      today,
      threshold: 5000,
      projection,
      commitments: [inv('2026-10-20', 4850, 'ventes', 'in', { id: 'l1' }), inv('2026-11-03', 100, 'ventes', 'in')],
      categories: [cat('loyer', 'out', null, { name: 'Loyer' } as never)],
      plan,
      connections: [{ id: 'cx', provider: 'bridge', bankName: 'Banque X', status: 'action_required', lastSyncAt: '2026-11-05T08:00:00Z' }],
      now: new Date('2026-11-07T10:00:00Z'),
    });
    expect(alerts.map((a) => a.message.replace(/[\u00a0\u202f]/g, ' '))).toEqual([
      'Votre trésorerie passera sous 5 000 € le 14 déc.',
      '1 facture client en retard de plus de 7 jours · 4 850 €.',
      'Loyer : 2 100 € réalisés pour 1 850 € prévus ce mois-ci (+14 %).',
      'La connexion à Banque X demande votre action depuis plus de 24 h : vos soldes ne sont plus à jour.',
    ]);
  });
});
