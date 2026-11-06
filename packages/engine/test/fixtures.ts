import type { Category, Scenario, Transaction, Commitment } from '../src';

export const cat = (id: string, flow: 'in' | 'out', parentId: string | null = null, extra: Partial<Category> = {}): Category => ({
  id,
  name: id,
  flow,
  parentId,
  position: 0,
  kind: 'none',
  vatRate: 20,
  budgetAtParent: false,
  ...extra,
});

export const scenarios: Scenario[] = [
  { id: 'base', name: 'Scénario de base', color: '#114C5C', isBase: true },
  { id: 'alt', name: 'Recrutement', color: '#8A6FB0', isBase: false },
];

let n = 0;
export const tx = (bookedAt: string, amount: number, categoryId: string | null, extra: Partial<Transaction> = {}): Transaction => ({
  id: `t${++n}`,
  accountId: 'a1',
  bookedAt,
  rawLabel: 'OPERATION',
  label: 'Opération',
  amount,
  categoryId,
  hidden: false,
  ...extra,
});

export const inv = (dueAt: string, amount: number, categoryId: string | null, flow: 'in' | 'out' = 'in', extra: Partial<Commitment> = {}): Commitment => ({
  id: `c${++n}`,
  flow,
  counterparty: 'Client',
  label: 'Facture',
  amountInclTax: amount,
  vatRate: 20,
  issuedAt: '2026-10-01',
  dueAt,
  status: 'pending',
  categoryId,
  hidden: false,
  ...extra,
});
