import { describe, expect, it } from 'vitest';
import {
  cleanBankLabel,
  computePlan,
  describeCondition,
  detectAutoExclusions,
  guessMapping,
  matchesSearch,
  missingFields,
  openingBalanceAt,
  parseAmount,
  parseDate,
  previewImport,
  proposeRuleFrom,
  ruleMatches,
  splitByPercentages,
  splitEqually,
  validateSplit,
  type Category,
  type Transaction,
} from '../src';

const tx = (p: Partial<Transaction> & Pick<Transaction, 'id' | 'amount'>): Transaction => ({
  accountId: 'a1',
  bookedAt: '2026-11-05',
  rawLabel: 'OPERATION',
  label: 'Opération',
  categoryId: null,
  hidden: false,
  ...p,
});

describe('cleanBankLabel', () => {
  it('retire les préfixes techniques et les références', () => {
    expect(cleanBankLabel('PRLV SEPA URSSAF AQUITAINE REF 0261105AB12').label).toBe('URSSAF Aquitaine');
    expect(cleanBankLabel('CARTE X8502 04/11 SUMUP *EZ PIEC').label).toBe('Sumup Ez Piec');
    expect(cleanBankLabel('VIR INST RECU M JEAN FRANCOIS ROY SOLDE DEVIS 000171').counterparty).toBe('M Jean Francois Roy');
  });
  it('écarte les lettres isolées des références de facture', () => {
    expect(cleanBankLabel('VIR INST RECU SCI LES PINS FACTURE F-2026-000135').label).toBe('SCI Les Pins');
    expect(cleanBankLabel('VIR INST RECU MME ETTER FACTURE F-2026-000175').label).toBe('Mme Etter');
  });
  it('garde un libellé lisible quand tout est du bruit', () => {
    expect(cleanBankLabel('CB 04/11 123456').label.length).toBeGreaterThan(0);
  });
});

describe('detectAutoExclusions', () => {
  it('apparie un virement entre deux comptes de la société (±3 jours)', () => {
    const r = detectAutoExclusions(
      [
        tx({ id: 'out', amount: -1000, accountId: 'a1', bookedAt: '2026-11-02', rawLabel: 'VIR VERS LIVRET' }),
        tx({ id: 'in', amount: 1000, accountId: 'a2', bookedAt: '2026-11-04', rawLabel: 'VIR DE COMPTE COURANT' }),
        tx({ id: 'far', amount: 1000, accountId: 'a2', bookedAt: '2026-11-20', rawLabel: 'VIR DE COMPTE COURANT' }),
      ],
      { refunds: true, internalTransfers: true },
    );
    expect(r.get('out')).toBe('internal_transfer');
    expect(r.get('in')).toBe('internal_transfer');
    expect(r.has('far')).toBe(false);
  });
  it('apparie un remboursement sur le même compte, même libellé, ≤ 30 jours', () => {
    const r = detectAutoExclusions(
      [
        tx({ id: 'achat', amount: -59.9, bookedAt: '2026-10-10', rawLabel: 'CARTE AMAZON EU 10/10' }),
        tx({ id: 'rembt', amount: 59.9, bookedAt: '2026-10-25', rawLabel: 'CARTE AMAZON EU 25/10' }),
      ],
      { refunds: true, internalTransfers: false },
    );
    expect([...r.values()]).toEqual(['refund', 'refund']);
  });
  it('respecte les réglages et ignore les opérations déjà catégorisées', () => {
    const list = [
      tx({ id: 'o', amount: -10, accountId: 'a1' }),
      tx({ id: 'i', amount: 10, accountId: 'a2', categoryId: 'ventes' }),
    ];
    expect(detectAutoExclusions(list, { refunds: true, internalTransfers: true }).size).toBe(0);
    expect(detectAutoExclusions([tx({ id: 'o', amount: -10 }), tx({ id: 'i', amount: 10, accountId: 'a2' })], { refunds: true, internalTransfers: false }).size).toBe(0);
  });
});

describe('import de fichiers', () => {
  it('lit les montants français et anglais', () => {
    expect(parseAmount('1 234,56')).toBe(1234.56);
    expect(parseAmount('-1.234,56 €')).toBe(-1234.56);
    expect(parseAmount('(120,00)')).toBe(-120);
    expect(parseAmount('1,234.56')).toBe(1234.56);
    expect(parseAmount('258.2')).toBe(258.2);
    expect(parseAmount('12-')).toBe(-12);
    expect(parseAmount('abc')).toBeNull();
  });
  it('lit les dates jour/mois et ISO, refuse les dates impossibles', () => {
    expect(parseDate('05/11/2026')).toBe('2026-11-05');
    expect(parseDate('5/11/26')).toBe('2026-11-05');
    expect(parseDate('2026-11-05')).toBe('2026-11-05');
    expect(parseDate('31/02/2026')).toBeNull();
  });
  it('devine la correspondance des colonnes et signale les champs manquants', () => {
    const m = guessMapping(['Date opération', 'Libellé', 'Débit', 'Crédit', 'Catégorie']);
    expect(m).toEqual({ 'Date opération': 'date', Libellé: 'label', Débit: 'debit', Crédit: 'credit', Catégorie: 'category' });
    expect(missingFields(m)).toEqual([]);
    expect(missingFields({ A: 'date' })).toEqual(['Libellé', 'Montant']);
  });
  it('reprend la correspondance mémorisée', () => {
    expect(guessMapping(['Col1', 'Col2'], { Col1: 'label', Col2: 'amount' })).toEqual({ Col1: 'label', Col2: 'amount' });
  });
  it('convertit les lignes, signale erreurs et doublons', () => {
    const p = previewImport(
      [
        { Date: '05/11/2026', Libellé: 'PRLV URSSAF', Débit: '407,00', Crédit: '' },
        { Date: '06/11/2026', Libellé: 'VIR CLIENT', Débit: '', Crédit: '1 013,56' },
        { Date: '32/11/2026', Libellé: 'X', Débit: '1', Crédit: '' },
        { Date: '07/11/2026', Libellé: '', Débit: '1', Crédit: '' },
        { Date: '', Libellé: '', Débit: '', Crédit: '' },
        { Date: '05/11/2026', Libellé: 'PRLV URSSAF', Débit: '407,00', Crédit: '' },
      ],
      { Date: 'date', Libellé: 'label', Débit: 'debit', Crédit: 'credit' },
      [],
    );
    expect(p.rows.map((r) => r.amount)).toEqual([-407, 1013.56, -407]);
    expect(p.errors.map((e) => e.line)).toEqual([4, 5]);
    expect(p.duplicates).toEqual([7]);
  });
  it('détecte une opération déjà connue', () => {
    const p = previewImport([{ d: '2026-11-05', l: 'PRLV URSSAF 1234', m: '-407' }], { d: 'date', l: 'label', m: 'amount' }, [
      { bookedAt: '2026-11-05', amount: -407, rawLabel: 'PRLV URSSAF 9999' },
    ]);
    expect(p.duplicates).toEqual([2]);
  });
});

describe('divisions', () => {
  it('répartit à parts égales (cas normatif 258,20 → 130,00 + 128,20)', () => {
    expect(splitEqually(258.2, 2)).toEqual([130, 128.2]);
    expect(splitEqually(-258.2, 2)).toEqual([-130, -128.2]);
  });
  it('répartit en pourcentages au centime près', () => {
    expect(splitByPercentages(100, [33.33, 33.33, 33.34])).toEqual([33.33, 33.33, 33.34]);
    expect(splitByPercentages(-10, [50, 50])).toEqual([-5, -5]);
    expect(() => splitByPercentages(10, [50, 40])).toThrow();
  });
  it('bloque la validation tant que le reste à répartir ≠ 0', () => {
    expect(validateSplit(258.2, [130, 128.2])).toBeNull();
    expect(validateSplit(258.2, [130, 128])).toBe('Reste à répartir : 0,20 €.');
    expect(validateSplit(258.2, [258.2])).toMatch(/au moins 2/);
    expect(validateSplit(-10, [-15, 5])).toMatch(/sens/);
  });
  it("une opération divisée est remplacée par ses lignes dans le plan, sans changer les soldes", () => {
    const cats: Category[] = [
      { id: 'four', name: 'Fournisseurs', flow: 'out', parentId: null, position: 0, kind: 'purchases', vatRate: 20, budgetAtParent: false },
      { id: 'repas', name: 'Repas', flow: 'out', parentId: null, position: 1, kind: 'overheads', vatRate: 10, budgetAtParent: false },
    ];
    const transactions = [
      tx({ id: 'p', amount: -258.2, isSplit: true, categoryId: 'four' }),
      tx({ id: 'p-1', amount: -130, parentId: 'p', categoryId: 'four' }),
      tx({ id: 'p-2', amount: -128.2, parentId: 'p', categoryId: 'repas' }),
    ];
    const plan = computePlan({
      categories: cats,
      transactions,
      commitments: [],
      budgets: [],
      scenarios: [{ id: 'base', name: 'Base', color: '#000', isBase: true }],
      months: ['2026-11-01'],
      today: '2026-11-06',
      mode: 'projection',
      openingBalance: 0,
      invoicesEnabled: true,
    });
    const rows = plan.scenarios.base!.rows;
    expect(rows.four!['2026-11-01']!.actual).toBe(130);
    expect(rows.repas!['2026-11-01']!.actual).toBe(128.2);
    expect(openingBalanceAt('2026-11-01', 1000, transactions, '2026-11-06')).toBe(1258.2);
  });
});

describe('règles et recherche', () => {
  it('applique toutes les conditions', () => {
    const rule = { conditions: [{ field: 'label' as const, op: 'contains' as const, value: 'urssaf' }, { field: 'amount' as const, op: 'between' as const, min: -1000, max: 0 }] };
    expect(ruleMatches(rule, { rawLabel: 'PRLV SEPA URSSAF AQUITAINE', amount: -407, accountId: 'a1' })).toBe(true);
    expect(ruleMatches(rule, { rawLabel: 'PRLV SEPA URSSAF AQUITAINE', amount: -1407, accountId: 'a1' })).toBe(false);
  });
  it('décrit les conditions en français', () => {
    expect(describeCondition({ field: 'label', op: 'contains', value: 'URSSAF' })).toBe('Libellé contient « URSSAF »');
    expect(describeCondition({ field: 'account', op: 'is', value: 'a1' }, () => 'Compte pro')).toBe('Compte : Compte pro');
  });
  it('propose une règle sur le tiers', () => {
    expect(proposeRuleFrom({ rawLabel: 'PRLV SEPA URSSAF AQUITAINE REF 99', counterparty: 'URSSAF Aquitaine' })).toEqual({ field: 'label', op: 'contains', value: 'urssaf aquitaine' });
  });
  it('cherche par texte, montant exact ou approché', () => {
    const t = { rawLabel: 'PRLV SEPA ORANGE SA', label: 'Orange SA', counterparty: 'Orange SA', note: 'mobile pro', amount: -69.84 };
    expect(matchesSearch(t, 'orange')).toBe(true);
    expect(matchesSearch(t, 'mobile')).toBe(true);
    expect(matchesSearch(t, '69,84')).toBe(true);
    expect(matchesSearch(t, '~70')).toBe(true);
    expect(matchesSearch(t, '~100')).toBe(false);
    expect(matchesSearch(t, 'free')).toBe(false);
  });
});
