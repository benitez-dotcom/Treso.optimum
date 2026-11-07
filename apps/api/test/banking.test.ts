import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import type { InjectOptions } from 'fastify';
import { withTenant } from '../src/db';
import { auth, OWNER_URL, setup, signupAndLogin, teardown, tokenFromLink, type TestCtx } from './helpers';

let ctx: TestCtx;
let token: string;
let companyId: string;
const inject = (opts: InjectOptions) => ctx.app.inject(opts);
const api = (method: InjectOptions['method'], url: string, payload?: unknown, t = token) =>
  inject({ method, url: `/api/v1${url}`, headers: auth(t), ...(payload !== undefined ? { payload: payload as InjectOptions['payload'] } : {}) });

type Tx = { id: string; amount: number; hidden: boolean; hiddenReason: string | null; categoryId: string | null; source: string; parentId: string | null; isSplit: boolean; bookedAt: string; originalBookedAt: string | null; label: string; rawLabel: string; accountId: string };
type Account = { id: string; name: string; balance: number; isActive: boolean; isManual: boolean; connectionId: string | null; isDefaultForCommitments: boolean; balanceSource: string };
const boot = async () => (await api('GET', '/bootstrap')).json() as { transactions: Tx[]; accounts: Account[]; connections: { id: string; status: string; bankName: string }[]; rules: { id: string; priority: number }[]; company: { settings: Record<string, unknown> } };

beforeAll(async () => {
  ctx = await setup();
  token = await signupAndLogin(ctx.app, 'banque@exemple.fr', 'Jérôme');
  companyId = (await api('POST', '/companies', { name: 'ALS Énergie' })).json().id;
});
afterAll(async () => {
  await teardown(ctx);
});

describe('banques', () => {
  let connectionId: string;

  it('indique les agrégateurs disponibles', async () => {
    expect((await api('GET', '/bank-providers')).json()).toEqual({ demo: true, bridge: false });
    const r = await api('POST', '/bank-connections/link', { provider: 'bridge' });
    expect(r.statusCode).toBe(400);
    expect(r.json().code).toBe('bank.provider_unavailable');
  });

  it('connecte la banque de démonstration : comptes, opérations, exclusions automatiques', async () => {
    const r = await api('POST', '/bank-connections/link', { provider: 'demo' });
    expect(r.statusCode).toBe(201);
    connectionId = r.json().connection.id;
    expect(r.json().connection).toMatchObject({ status: 'ok', bankName: 'Banque de démonstration' });
    expect(r.json().accounts).toBe(2);
    expect(r.json().imported).toBeGreaterThan(30);

    const b = await boot();
    const courant = b.accounts.find((a) => a.name === 'Compte courant pro')!;
    const livret = b.accounts.find((a) => a.name === 'Livret pro')!;
    expect(courant.isActive).toBe(true);
    expect(livret.isActive).toBe(false); // épargne exclue par défaut
    expect(courant.balance).not.toBe(0);

    const hidden = b.transactions.filter((t) => t.hidden);
    expect(hidden.filter((t) => t.hiddenReason === 'internal_transfer')).toHaveLength(2);
    expect(hidden.filter((t) => t.hiddenReason === 'refund')).toHaveLength(2);
    // Libellé nettoyé
    expect(b.transactions.find((t) => t.rawLabel.startsWith('PRLV SEPA URSSAF'))!.label).toBe('URSSAF Aquitaine');
  });

  it('une nouvelle synchronisation ne crée pas de doublons', async () => {
    const before = (await boot()).transactions.length;
    const r = await api('POST', `/bank-connections/${connectionId}/sync`);
    expect(r.statusCode).toBe(200);
    expect(r.json().imported).toBe(0);
    expect((await boot()).transactions.length).toBe(before);
  });

  it('règle les comptes : nom, solde retenu, compte par défaut des factures', async () => {
    const b = await boot();
    const livret = b.accounts.find((a) => a.name === 'Livret pro')!;
    const courant = b.accounts.find((a) => a.name === 'Compte courant pro')!;
    const refused = await api('PATCH', `/bank-accounts/${livret.id}`, { isDefaultForCommitments: true });
    expect(refused.json().code).toBe('bank.default_requires_active');
    expect((await api('PATCH', `/bank-accounts/${livret.id}`, { balanceSource: 'instant' })).json().code).toBe('bank.balance_unavailable');

    const ok = await api('PATCH', `/bank-accounts/${courant.id}`, { displayName: 'Compte pro', isDefaultForCommitments: true, balanceSource: 'booked' });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ displayName: 'Compte pro', isDefaultForCommitments: true, balanceSource: 'booked' });
    // Exclure le compte retire aussi le statut « par défaut »
    const off = await api('PATCH', `/bank-accounts/${courant.id}`, { isActive: false });
    expect(off.json()).toMatchObject({ isActive: false, isDefaultForCommitments: false });
    await api('PATCH', `/bank-accounts/${courant.id}`, { isActive: true });
  });

  it('limite à une banque sur l’offre Essentiel', async () => {
    const owner = new pg.Client({ connectionString: OWNER_URL });
    await owner.connect();
    await owner.query("UPDATE companies SET plan = 'ESSENTIAL' WHERE id = $1", [companyId]);
    const r = await api('POST', '/bank-connections/link', { provider: 'demo' });
    expect(r.statusCode).toBe(403);
    expect(r.json().title).toBe('Votre offre inclut 1 banque. Passez à Performance pour en ajouter.');
    await owner.query("UPDATE companies SET plan = 'PERFORMANCE' WHERE id = $1", [companyId]);
    await owner.end();
  });
});

describe('opérations', () => {
  let manualId: string;

  it('crée un compte manuel ; son solde suit les opérations saisies', async () => {
    const acc = await api('POST', '/bank-accounts', { name: 'Caisse', openingBalance: 200, openingDate: '2026-01-01' });
    expect(acc.statusCode).toBe(201);
    manualId = acc.json().id;
    const t = await api('POST', '/transactions', { accountId: manualId, bookedAt: '2026-11-03', label: 'Achat fournitures', amount: -45.5 });
    expect(t.statusCode).toBe(201);
    expect(t.json()).toMatchObject({ source: 'manual', amount: -45.5 });
    expect((await boot()).accounts.find((a) => a.id === manualId)!.balance).toBe(154.5);

    // Saisie interdite sur un compte synchronisé
    const synced = (await boot()).accounts.find((a) => a.connectionId)!;
    expect((await api('POST', '/transactions', { accountId: synced.id, bookedAt: '2026-11-03', label: 'x', amount: 1 })).json().code).toBe('transaction.account_synced');
  });

  it('supprime une opération saisie, pas une opération bancaire', async () => {
    const b = await boot();
    const manual = b.transactions.find((t) => t.source === 'manual')!;
    const bank = b.transactions.find((t) => t.source === 'bank')!;
    const refused = await api('POST', '/transactions/delete', { ids: [manual.id, bank.id] });
    expect(refused.statusCode).toBe(400);
    expect(refused.json().code).toBe('transaction.delete_bank');
    expect((await api('POST', '/transactions/delete', { ids: [manual.id] })).json()).toEqual({ deleted: 1 });
    expect((await boot()).accounts.find((a) => a.id === manualId)!.balance).toBe(200);
  });

  it('divise 258,20 en 130,00 + 128,20, refuse un reste ≠ 0, puis annule la division', async () => {
    const b = await boot();
    const target = b.transactions.find((t) => t.amount < -100 && !t.hidden && !t.parentId)!;
    const amount = target.amount;
    const bad = await api('POST', `/transactions/${target.id}/split`, { lines: [{ amount: amount + 1, categoryId: null }, { amount: -0.5, categoryId: null }] });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().title).toMatch(/^Reste à répartir/);

    const cats = (await api('GET', '/bootstrap')).json().categories as { id: string; flow: string }[];
    const outCats = cats.filter((c) => c.flow === 'out');
    const first = Math.round((amount / 2) * 100) / 100;
    const ok = await api('POST', `/transactions/${target.id}/split`, {
      lines: [{ amount: first, categoryId: outCats[0]!.id }, { amount: Math.round((amount - first) * 100) / 100, categoryId: outCats[1]!.id }],
    });
    expect(ok.statusCode).toBe(200);
    const parts = ok.json().transactions as Tx[];
    expect(parts.find((t) => t.id === target.id)!.isSplit).toBe(true);
    expect(parts.filter((t) => t.parentId === target.id)).toHaveLength(2);
    // On ne catégorise pas l'opération divisée elle-même
    expect((await api('PATCH', `/transactions/${target.id}`, { categoryId: outCats[0]!.id })).json().code).toBe('transaction.split');

    const undo = await api('DELETE', `/transactions/${target.id}/split`);
    expect(undo.json()).toMatchObject({ isSplit: false, categoryId: outCats[0]!.id });
    expect((await boot()).transactions.filter((t) => t.parentId === target.id)).toHaveLength(0);
  });

  it('change la date d’imputation puis revient à la date bancaire', async () => {
    const t = (await boot()).transactions.find((x) => !x.parentId && !x.isSplit)!;
    const moved = await api('PATCH', `/transactions/${t.id}`, { bookedAt: '2026-12-01' });
    expect(moved.json()).toMatchObject({ bookedAt: '2026-12-01', originalBookedAt: t.bookedAt });
    const back = await api('PATCH', `/transactions/${t.id}`, { resetBookedAt: true });
    expect(back.json()).toMatchObject({ bookedAt: t.bookedAt, originalBookedAt: null });
  });

  it('exclut et réintègre une opération, valide une suggestion en lot', async () => {
    const t = (await boot()).transactions.find((x) => !x.hidden && !x.parentId && !x.isSplit)!;
    await api('POST', '/transactions/batch', { ops: [{ id: t.id, hidden: true }] });
    expect((await boot()).transactions.find((x) => x.id === t.id)).toMatchObject({ hidden: true, hiddenReason: 'manual' });
    await api('POST', '/transactions/batch', { ops: [{ id: t.id, hidden: false }] });
    expect((await boot()).transactions.find((x) => x.id === t.id)).toMatchObject({ hidden: false, hiddenReason: null });
  });
});

describe('import de fichier', () => {
  let importId: string;
  it('importe, rattache les catégories par leur nom et mémorise la correspondance', async () => {
    const b = await boot();
    const caisse = b.accounts.find((a) => a.isManual)!;
    const r = await api('POST', '/transactions/import', {
      fileName: 'releve-novembre.csv',
      accountId: caisse.id,
      mapping: { Date: 'date', Libellé: 'label', Montant: 'amount', Catégorie: 'category' },
      rows: [
        { bookedAt: '2026-11-02', rawLabel: 'VENTE COMPTOIR', amount: 120, categoryName: 'ventes' },
        { bookedAt: '2026-11-04', rawLabel: 'LOYER BOUTIQUE', amount: -500, categoryName: 'Loyer' },
        { bookedAt: '2026-11-05', rawLabel: 'DIVERS', amount: -12.4, categoryName: 'Catégorie inconnue' },
      ],
    });
    expect(r.statusCode).toBe(201);
    expect(r.json().imported).toBe(3);
    importId = r.json().importId;
    const imported = (await boot()).transactions.filter((t) => t.source === 'import');
    expect(imported.find((t) => t.rawLabel === 'VENTE COMPTOIR')!.categoryId).toBe('ventes');
    expect(imported.find((t) => t.rawLabel === 'LOYER BOUTIQUE')!.categoryId).toBe('loyer');
    expect(imported.find((t) => t.rawLabel === 'DIVERS')!.categoryId).toBeNull();
    expect((await api('GET', '/import-mappings/transactions')).json().mapping).toMatchObject({ Date: 'date' });
    expect((await api('GET', '/imports')).json()[0]).toMatchObject({ fileName: 'releve-novembre.csv', rowsCount: 3, author: 'Jérôme' });
  });

  it('annuler l’import supprime ce qu’il a créé', async () => {
    expect((await api('DELETE', `/imports/${importId}`)).statusCode).toBe(204);
    expect((await boot()).transactions.filter((t) => t.source === 'import')).toHaveLength(0);
    expect((await api('GET', '/imports')).json()).toHaveLength(0);
  });
});

describe('règles', () => {
  it('crée une règle, l’applique aux opérations existantes, la réordonne et la supprime', async () => {
    const r1 = await api('POST', '/rules', { conditions: [{ field: 'label', op: 'contains', value: 'orange' }], categoryId: 'logiciels', autoApply: true });
    expect(r1.statusCode).toBe(201);
    const applied = await api('POST', `/rules/${r1.json().id}/apply`, {});
    expect(applied.json().updated).toBeGreaterThan(0);
    const orange = (await boot()).transactions.filter((t) => t.rawLabel.includes('ORANGE') && !t.hidden);
    expect(orange.every((t) => t.categoryId === 'logiciels')).toBe(true);

    const r2 = await api('POST', '/rules', { conditions: [{ field: 'amount', op: 'between', min: -100, max: -50 }], categoryId: 'honoraires' });
    await api('PUT', '/rules/order', { ids: [r2.json().id, r1.json().id] });
    const rules = (await boot()).rules;
    expect(rules[0]!.id).toBe(r2.json().id);

    const patched = await api('PATCH', `/rules/${r2.json().id}`, { autoApply: true });
    expect(patched.json().autoApply).toBe(true);
    expect((await api('DELETE', `/rules/${r2.json().id}`)).statusCode).toBe(204);
  });

  it('les nouvelles opérations suivent les règles automatiques', async () => {
    const caisse = (await boot()).accounts.find((a) => a.isManual)!;
    const t = await api('POST', '/transactions', { accountId: caisse.id, bookedAt: '2026-11-06', label: 'PRLV ORANGE SA MOBILE', amount: -39.99 });
    expect(t.json().categoryId).toBe('logiciels');
  });
});

describe('droits et cloisonnement', () => {
  it('un lecteur ne peut ni connecter une banque ni modifier une opération', async () => {
    const inv = await api('POST', '/invitations', { email: 'lecteur-banque@exemple.fr', role: 'VIEWER' });
    await inject({ method: 'POST', url: `/api/v1/invitations/${tokenFromLink(inv.json().devLink)}/accept`, payload: { firstName: 'Léa', password: 'lecture seule sans risque' } });
    const viewer = (await inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'lecteur-banque@exemple.fr', password: 'lecture seule sans risque' } })).json().accessToken as string;
    const t = (await boot()).transactions[0]!;
    expect((await api('POST', '/bank-connections/link', { provider: 'demo' }, viewer)).statusCode).toBe(403);
    expect((await api('PATCH', `/transactions/${t.id}`, { hidden: true }, viewer)).statusCode).toBe(403);
    expect((await api('POST', '/transactions/import', { fileName: 'x.csv', accountId: 'x', rows: [] }, viewer)).statusCode).toBe(403);
  });

  it('RLS : les connexions et imports d’une société restent invisibles pour une autre', async () => {
    const other = await signupAndLogin(ctx.app, 'voisin@exemple.fr', 'Voisin');
    const otherCompany = (await api('POST', '/companies', { name: 'Voisin SARL' }, other)).json().id as string;
    expect((await api('GET', '/bank-connections', undefined, other)).json()).toEqual({ connections: [], accounts: [] });
    const rows = await withTenant(ctx.db, { userId: 'ffffffff-ffff-4fff-8fff-ffffffffffff', companyId: otherCompany }, async (tx) =>
      (await tx.query('SELECT count(*)::int AS n FROM bank_connections')).rows[0].n,
    );
    expect(rows).toBe(0);
    const sync = await api('POST', '/bank-connections/x/sync', undefined, other);
    expect(sync.statusCode).toBe(404);
  });
});
