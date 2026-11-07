import { describe, expect, it } from 'vitest';
import {
  buildFec,
  checkEntry,
  DEFAULT_CHART,
  DEFAULT_VAT_ACCOUNTS,
  defaultJournals,
  FEC_COLUMNS,
  invoiceEntry,
  suggestAccount,
  transactionEntry,
  type Entry,
  type PrecomptaContext,
} from '../src';
import { cat, inv, tx } from './fixtures';

const categories = [
  cat('ventes', 'in', null, { name: 'Ventes', kind: 'revenue', vatRate: 20 }),
  cat('loyer', 'out', null, { name: 'Loyer', vatRate: 20 }),
  cat('urssaf', 'out', null, { name: 'URSSAF', vatRate: 0 }),
  cat('divers', 'out', null, { name: 'Divers' }),
];
const ctx: PrecomptaContext = { categories, mappings: {}, vat: DEFAULT_VAT_ACCOUNTS, journals: defaultJournals([{ id: 'a1', type: 'checking' }]) };

describe('correspondances automatiques', () => {
  it('par nom puis par nature', () => {
    expect(suggestAccount({ name: 'Loyer de l’atelier', flow: 'out', kind: 'none' })).toBe('613200');
    expect(suggestAccount({ name: 'URSSAF', flow: 'out', kind: 'none' })).toBe('645100');
    expect(suggestAccount({ name: 'Ventes', flow: 'in', kind: 'revenue' })).toBe('706000');
    expect(suggestAccount({ name: 'Divers', flow: 'out', kind: 'purchases' })).toBe('607000');
    expect(suggestAccount({ name: 'Divers', flow: 'out', kind: 'none' })).toBe('471000');
    expect(suggestAccount({ name: 'TVA', flow: 'out', kind: 'none', isVat: true })).toBe('445510');
  });
});

describe('écritures proposées', () => {
  it('facture de vente : 411 au TTC, 706 au HT, 445711 la TVA', () => {
    const e = invoiceEntry(inv('2026-12-01', 1200, 'ventes', 'in', { counterparty: 'Studio Lumen', number: 'FA-12', issuedAt: '2026-11-02' }), ctx);
    expect(e.journal).toBe('VT');
    expect(e.lines.map((l) => [l.account, l.debit, l.credit])).toEqual([
      ['411000', 1200, 0],
      ['706000', 0, 1000],
      ['445711', 0, 200],
    ]);
    expect(e.lines[0]!.auxAccount).toBe('411STUDIOLU');
    expect(checkEntry(e).ok).toBe(true);
  });

  it('facture d’achat : charge HT, TVA déductible, 401 au TTC', () => {
    const e = invoiceEntry(inv('2026-12-05', 1850, 'loyer', 'out', { counterparty: 'Foncière Dupont' }), ctx);
    expect(e.journal).toBe('HA');
    expect(e.lines.map((l) => [l.account, l.debit, l.credit])).toEqual([
      ['613200', 1541.67, 0],
      ['445660', 308.33, 0],
      ['401000', 0, 1850],
    ]);
    expect(checkEntry(e).ok).toBe(true);
  });

  it('opération bancaire non rapprochée : banque contre charge', () => {
    const e = transactionEntry(tx('2026-11-03', -450, 'urssaf', { accountId: 'a1', counterparty: 'URSSAF' }), ctx);
    expect(e.journal).toBe('BQ1');
    expect(e.lines.map((l) => [l.account, l.debit, l.credit])).toEqual([
      ['512001', 0, 450],
      ['645100', 450, 0],
    ]);
  });

  it('opération rapprochée en partie : tiers puis reste en produit', () => {
    const facture = inv('2026-11-01', 1000, 'ventes', 'in', { counterparty: 'Hôtel des Pins' });
    const e = transactionEntry(tx('2026-11-04', 1200, 'ventes', { accountId: 'a1' }), ctx, [{ commitment: facture, amount: 1000 }]);
    expect(e.lines.map((l) => [l.account, l.debit, l.credit])).toEqual([
      ['512001', 1200, 0],
      ['411000', 0, 1000],
      ['706000', 0, 166.67],
      ['445711', 0, 33.33],
    ]);
    expect(checkEntry(e).ok).toBe(true);
  });
});

describe('contrôle d’équilibre', () => {
  it('une écriture déséquilibrée ne peut pas être validée', () => {
    const r = checkEntry({
      journal: 'HA',
      date: '2026-11-03',
      pieceRef: 'X',
      label: 'Achat',
      lines: [
        { account: '607000', label: 'Achat', debit: 100, credit: 0 },
        { account: '401000', label: 'Achat', debit: 0, credit: 87.6 },
      ],
    });
    expect(r.ok).toBe(false);
    expect(r.errors).toContain('Écart de 12,40 € entre débit et crédit');
  });

  it('comptes inconnus et lignes vides', () => {
    const r = checkEntry(
      { journal: 'HA', date: '2026-11-03', pieceRef: 'X', label: 'A', lines: [{ account: '999999', label: '', debit: 0, credit: 0 }] },
      DEFAULT_CHART,
    );
    expect(r.errors).toEqual([
      'Une écriture compte au moins deux lignes.',
      'Ligne 1 : le compte 999999 n’existe pas dans le plan de comptes.',
      'Ligne 1 : montant manquant.',
    ]);
  });
});

describe('FEC', () => {
  const base = invoiceEntry(inv('2026-12-01', 1200, 'ventes', 'in', { counterparty: 'Studio | Lumen', number: 'FA-12', issuedAt: '2026-11-02' }), ctx);
  const entry = (n: number, extra: Partial<Entry> = {}): Entry => ({ ...base, id: `e${n}`, status: 'validated', number: n, validatedAt: '2026-11-07', ...extra });
  const input = { siren: '123456789', closingDate: '2026-12-31', from: '2026-01-01', to: '2026-12-31', chart: DEFAULT_CHART, journalLabels: { VT: 'Ventes' } };

  it('18 colonnes, séparateur |, dates AAAAMMJJ, virgule décimale', () => {
    const r = buildFec({ ...input, entries: [entry(1), entry(2), { ...entry(3), status: 'draft' }] });
    expect(r.errors).toEqual([]);
    expect(r.fileName).toBe('123456789FEC20261231.txt');
    const rows = r.content.trim().split('\r\n');
    expect(rows[0]!.split('|')).toEqual([...FEC_COLUMNS]);
    expect(rows).toHaveLength(1 + 2 * 3);
    const cols = rows[1]!.split('|');
    expect(cols).toHaveLength(18);
    expect(cols.slice(0, 5)).toEqual(['VT', 'Ventes', '1', '20261102', '411000']);
    expect(cols[7]).toBe('Studio Lumen');
    expect(cols[11]).toBe('1200,00');
    expect(cols[15]).toBe('20261107');
  });

  it('contrôle de conformité avant export', () => {
    const r = buildFec({ ...input, siren: '', entries: [entry(1, { lines: [{ account: '411000', label: 'x', debit: 10, credit: 0 }, { account: '706000', label: 'x', debit: 0, credit: 9 }] }), entry(3)] });
    expect(r.errors[0]).toBe('SIREN manquant ou invalide : renseignez-le dans Paramètres › Société.');
    expect(r.errors.some((e) => e.includes('Écart de 1,00 €'))).toBe(true);
    expect(r.warnings).toContain('Journal VT : numérotation discontinue (2 attendu, 3 trouvé).');
  });
});
