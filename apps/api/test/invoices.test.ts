import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { InjectOptions } from 'fastify';
import { addDays, addMonths, monthOf, todayInParis } from '@optimum/treso-engine';
import type { MemoryMailer } from '../src/mailer';
import { auth, setup, signupAndLogin, teardown, type TestCtx } from './helpers';

let ctx: TestCtx;
let token: string;
const api = (method: InjectOptions['method'], url: string, payload?: unknown, t = token) =>
  ctx.app.inject({ method, url: `/api/v1${url}`, headers: auth(t), ...(payload !== undefined ? { payload: payload as InjectOptions['payload'] } : {}) });

type C = { id: string; dueAt: string; issuedAt: string; amountInclTax: number; amountPaid: number; status: string; seriesId: string | null; seriesIndex: number | null; replacedBy: string | null; notDuplicateOf: string | null; categoryId: string | null; number?: string; counterparty: string; source: string; paidAt: string | null };
type Boot = { commitments: C[]; reconciliations: { id: string; transactionId: string; commitmentId: string; amount: number }[]; transactions: { id: string; amount: number; categoryId: string | null; accountId: string }[]; accounts: { id: string; isManual: boolean }[] };
const boot = async () => (await api('GET', '/bootstrap')).json() as Boot;

const today = todayInParis();
const next = (n: number) => `${addMonths(monthOf(today), n).slice(0, 8)}10`;

beforeAll(async () => {
  ctx = await setup();
  token = await signupAndLogin(ctx.app, 'factures@exemple.fr', 'Paul');
  await api('POST', '/companies', { name: 'Menuiserie Paul' });
});
afterAll(async () => {
  await teardown(ctx);
});

const base = {
  flow: 'out',
  counterparty: 'Foncière Dupont',
  categoryId: 'loyer',
  amountInclTax: 1850,
  vatRate: 20,
  issuedAt: today,
  paymentTerms: 'custom',
};

describe('séries récurrentes', () => {
  let ids: string[] = [];

  it('une série mensuelle de 12 crée 12 échéances', async () => {
    const r = await api('POST', '/commitments', { ...base, dueAt: next(1), repeat: { intervalMonths: 1, count: 12 } });
    expect(r.statusCode).toBe(201);
    const list = r.json().commitments as C[];
    expect(list).toHaveLength(12);
    expect(new Set(list.map((c) => c.seriesId)).size).toBe(1);
    expect(list.map((c) => c.seriesIndex)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(list[11]!.dueAt).toBe(next(12));
    ids = list.map((c) => c.id);
  });

  it('« et les suivantes » épargne les échéances payées', async () => {
    await api('PATCH', `/commitments/${ids[4]}`, { status: 'paid' });
    const r = await api('PATCH', `/commitments/${ids[2]}`, { amountInclTax: 1900, scope: 'following' });
    expect(r.statusCode).toBe(200);
    expect(r.json().commitments).toHaveLength(9); // 3e à 12e, sauf la 5e payée
    const b = await boot();
    const amount = (i: number) => b.commitments.find((c) => c.id === ids[i])!.amountInclTax;
    expect([amount(1), amount(2), amount(4), amount(5), amount(11)]).toEqual([1850, 1900, 1850, 1900, 1900]);
    expect(b.commitments.find((c) => c.id === ids[4])!.paidAt).toBe(today);
  });

  it('décaler une échéance décale les suivantes du même nombre de jours', async () => {
    await api('PATCH', `/commitments/${ids[9]}`, { dueAt: addDays(next(10), 3), scope: 'following' });
    const b = await boot();
    expect(b.commitments.find((c) => c.id === ids[9])!.dueAt).toBe(addDays(next(10), 3));
    expect(b.commitments.find((c) => c.id === ids[11])!.dueAt).toBe(addDays(next(12), 3));
    expect(b.commitments.find((c) => c.id === ids[8])!.dueAt).toBe(next(9));
  });

  it('supprime cette échéance et les suivantes', async () => {
    const r = await api('DELETE', `/commitments/${ids[10]}?scope=following`);
    expect(r.json().deleted).toHaveLength(2);
    expect((await boot()).commitments.filter((c) => c.seriesId)).toHaveLength(10);
  });

  it('valide les champs', async () => {
    const r = await api('POST', '/commitments', { ...base, amountInclTax: 0, dueAt: next(1) });
    expect(r.statusCode).toBe(422);
    expect(r.json().details[0].message).toBe('Indiquez le montant TTC');
    expect((await api('POST', '/commitments', { ...base, categoryId: 'ventes', dueAt: next(1) })).json().title).toBe('Choisissez une catégorie de décaissement.');
    expect((await api('POST', '/commitments', { ...base, dueAt: next(1), repeat: { intervalMonths: 1, count: 121 } })).statusCode).toBe(422);
  });
});

describe('rapprochements', () => {
  let accountId: string;
  let paymentId: string;
  let f1: string;
  let f2: string;

  beforeAll(async () => {
    accountId = (await api('POST', '/bank-accounts', { name: 'Caisse', openingBalance: 0, openingDate: '2026-01-01' })).json().id;
    paymentId = (await api('POST', '/transactions', { accountId, bookedAt: today, label: 'VIR STUDIO LUMEN', amount: 1500 })).json().id;
    const mk = async (amountInclTax: number, number: string) =>
      ((await api('POST', '/commitments', { ...base, flow: 'in', counterparty: 'Studio Lumen', categoryId: 'ventes', amountInclTax, number, dueAt: today })).json().commitments as C[])[0]!.id;
    f1 = await mk(1000, 'FA-1');
    f2 = await mk(900, 'FA-2');
  });

  it('un paiement règle une facture puis une partie d’une autre', async () => {
    const r1 = await api('POST', '/reconciliations', { transactionId: paymentId, commitmentId: f1 });
    expect(r1.statusCode).toBe(201);
    expect(r1.json().commitment).toMatchObject({ status: 'paid', amountPaid: 1000, paidAt: today });
    expect(r1.json().transactionCategoryId).toBe('ventes');
    const r2 = await api('POST', '/reconciliations', { transactionId: paymentId, commitmentId: f2 });
    expect(r2.json().reconciliation.amount).toBe(500);
    expect(r2.json().commitment).toMatchObject({ status: 'pending', amountPaid: 500 });
  });

  it('refuse un rapprochement supérieur au montant du paiement', async () => {
    const f3 = ((await api('POST', '/commitments', { ...base, flow: 'in', counterparty: 'Hôtel', categoryId: 'ventes', amountInclTax: 50, dueAt: today })).json().commitments as C[])[0]!.id;
    const r = await api('POST', '/reconciliations', { transactionId: paymentId, commitmentId: f3, amount: 10 });
    expect(r.statusCode).toBe(400);
    expect(r.json().title).toBe('Le total des factures dépasse le montant de ce paiement.');
  });

  it('annuler un rapprochement rouvre la facture', async () => {
    const rec = (await boot()).reconciliations.find((r) => r.commitmentId === f1)!;
    const r = await api('DELETE', `/reconciliations/${rec.id}`);
    expect(r.json().commitment).toMatchObject({ status: 'pending', amountPaid: 0, paidAt: null });
  });
});

describe('doublons, import, relance', () => {
  it('remplace une échéance manuelle par la facture importée', async () => {
    const manual = ((await api('POST', '/commitments', { ...base, counterparty: 'Atelier Bois', categoryId: 'achats', amountInclTax: 400, dueAt: next(2) })).json().commitments as C[])[0]!;
    const imp = await api('POST', '/commitments/import', {
      flow: 'out',
      fileName: 'factures.csv',
      mapping: { Fournisseur: 'counterparty', Montant: 'amount' },
      rows: [
        { counterparty: 'ATELIER BOIS', number: 'AB-77', label: 'Planches', amountInclTax: 402, vatRate: null, issuedAt: today, dueAt: next(2), categoryId: null, note: null },
        { counterparty: 'Quincaillerie', number: 'Q-1', label: 'Vis', amountInclTax: 35.5, vatRate: 20, issuedAt: today, dueAt: next(1), categoryId: 'achats', note: null },
      ],
    });
    expect(imp.statusCode).toBe(201);
    expect(imp.json().imported).toBe(2);
    expect((await api('GET', '/import-mappings/commitments')).json().mapping).toEqual({ Fournisseur: 'counterparty', Montant: 'amount' });
    const imported = (await boot()).commitments.find((c) => c.number === 'AB-77')!;
    expect(imported.source).toBe('import');
    const r = await api('POST', '/commitments/duplicates/resolve', { manualId: manual.id, importedId: imported.id, action: 'replace' });
    const after = r.json().commitments as C[];
    expect(after.find((c) => c.id === manual.id)!.replacedBy).toBe(imported.id);
    expect(after.find((c) => c.id === imported.id)!.categoryId).toBe('achats');

    // Annuler l'import supprime ses factures et libère l'échéance remplacée
    const importId = imp.json().importId;
    expect((await api('DELETE', `/imports/${importId}`)).statusCode).toBe(204);
    const b = await boot();
    expect(b.commitments.find((c) => c.number === 'AB-77')).toBeUndefined();
  });

  it('prépare et envoie une relance au client', async () => {
    const c = ((await api('POST', '/commitments', { ...base, flow: 'in', counterparty: 'Cabinet Arcade', categoryId: 'ventes', amountInclTax: 4850, number: 'FA-098', issuedAt: addDays(today, -40), dueAt: addDays(today, -10) })).json().commitments as C[])[0]!;
    const draft = (await api('GET', `/commitments/${c.id}/reminder`)).json();
    expect(draft.subject).toContain('FA-098');
    expect(draft.body).toContain('depuis 10 jours');
    const r = await api('POST', `/commitments/${c.id}/reminder`, { to: 'compta@arcade.fr', subject: draft.subject, body: draft.body });
    expect(r.json().message).toBe('Relance envoyée à compta@arcade.fr.');
    const mail = (ctx.app.deps.mailer as MemoryMailer).last('compta@arcade.fr')!;
    expect(mail).toMatchObject({ subject: draft.subject, replyTo: 'factures@exemple.fr', plain: true });
  });

  it('compte par défaut d’une catégorie', async () => {
    const acc = (await boot()).accounts[0]!.id;
    expect((await api('PATCH', '/categories/loyer', { defaultAccountId: acc })).statusCode).toBe(200);
    const b = (await api('GET', '/bootstrap')).json() as { categories: { id: string; defaultAccountId: string | null }[] };
    expect(b.categories.find((c) => c.id === 'loyer')!.defaultAccountId).toBe(acc);
  });
});
