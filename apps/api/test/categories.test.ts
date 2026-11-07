import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { InjectOptions } from 'fastify';
import { auth, setup, signupAndLogin, teardown, type TestCtx } from './helpers';

let ctx: TestCtx;
let token: string;
const api = (method: InjectOptions['method'], url: string, payload?: unknown) =>
  ctx.app.inject({ method, url: `/api/v1${url}`, headers: auth(token), ...(payload !== undefined ? { payload: payload as InjectOptions['payload'] } : {}) });

type Cat = { id: string; name: string; flow: string; parentId: string | null; position: number; kind: string; vatRate: number; budgetAtParent: boolean; icon: string | null; color: string | null; note: string | null };
type Boot = { categories: Cat[]; budgets: { scenarioId: string; categoryId: string; month: string; amount: number }[]; transactions: { id: string; categoryId: string | null }[]; rules: { categoryId: string }[] };
const boot = async () => (await api('GET', '/bootstrap')).json() as Boot;
const byName = async (n: string) => (await boot()).categories.find((c) => c.name === n)!;

beforeAll(async () => {
  ctx = await setup();
  token = await signupAndLogin(ctx.app, 'cat@exemple.fr', 'Claire');
  await api('POST', '/companies', { name: 'Atelier Catégories' });
});
afterAll(async () => teardown(ctx));

describe('catégories', () => {
  it('crée une catégorie et une sous-catégorie', async () => {
    const r = await api('POST', '/categories', { name: 'Marketing', flow: 'out', kind: 'overheads', vatRate: 20, icon: 'notification', color: '#2a78d6' });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ name: 'Marketing', kind: 'overheads', vatRate: 20, icon: 'notification', color: '#2a78d6', parentId: null });
    const sub = await api('POST', '/categories', { name: 'Salons', flow: 'out', parentId: r.json().id });
    expect(sub.json().parentId).toBe(r.json().id);
  });

  it('refuse un doublon, un sens incohérent, un taux de TVA inconnu', async () => {
    const dup = await api('POST', '/categories', { name: ' marketing ', flow: 'out' });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().title).toBe('Une catégorie « marketing » existe déjà à cet endroit.');
    const m = await byName('Marketing');
    expect((await api('POST', '/categories', { name: 'X', flow: 'in', parentId: m.id })).statusCode).toBe(400);
    expect((await api('POST', '/categories', { name: 'Y', flow: 'out', vatRate: 19.6 })).statusCode).toBe(422);
  });

  it('modifie la nature, la note et le budget global', async () => {
    const m = await byName('Marketing');
    const r = await api('PATCH', `/categories/${m.id}`, { kind: 'purchases', note: 'Salons et pub', budgetAtParent: true });
    expect(r.json()).toMatchObject({ kind: 'purchases', note: 'Salons et pub', budgetAtParent: true });
  });

  it('déplacement vers un parent budgété globalement : demande quoi faire des budgets', async () => {
    const m = await byName('Marketing');
    const loyer = (await boot()).categories.find((c) => c.name === 'Loyer')!;
    await api('PUT', '/budgets', { changes: [{ scenarioId: 'base', categoryId: loyer.id, month: '2027-01-01', amount: 1000 }, { scenarioId: 'base', categoryId: m.id, month: '2027-01-01', amount: 200 }] });
    const preview = await api('POST', `/categories/${loyer.id}/move-preview`, { parentId: m.id });
    expect(preview.json()).toMatchObject({ kind: 'mergeIntoParent', months: 1 });
    const blocked = await api('POST', `/categories/${loyer.id}/move`, { parentId: m.id, index: 0 });
    expect(blocked.statusCode).toBe(409);
    const ok = await api('POST', `/categories/${loyer.id}/move`, { parentId: m.id, index: 0, budgets: 'sum' });
    expect(ok.statusCode).toBe(200);
    const b = await boot();
    expect(b.categories.find((c) => c.id === loyer.id)!.parentId).toBe(m.id);
    expect(b.budgets.filter((x) => x.categoryId === loyer.id)).toEqual([]);
    expect(b.budgets.find((x) => x.categoryId === m.id && x.month === '2027-01-01')!.amount).toBe(1200);
  });

  it('interdit les cycles', async () => {
    const m = await byName('Marketing');
    const salons = await byName('Salons');
    const r = await api('POST', `/categories/${m.id}/move`, { parentId: salons.id, index: 0 });
    expect(r.json().title).toBe('Une catégorie ne peut pas être rangée dans l’une de ses sous-catégories.');
  });

  it('suppression : propose de déplacer si la catégorie contient des données', async () => {
    const m = await byName('Marketing');
    const r = await api('DELETE', `/categories/${m.id}`);
    expect(r.statusCode).toBe(409);
    expect(r.json().title).toMatch(/^« Marketing » contient 2 sous-catégories, 1 budget\. Choisissez la catégorie qui les recevra\.$/);
    const fg = (await boot()).categories.find((c) => c.name === 'Frais généraux' || c.kind === 'overheads' && !c.parentId && c.id !== m.id)!;
    expect((await api('DELETE', `/categories/${m.id}?moveTo=${fg.id}`)).statusCode).toBe(204);
    const b = await boot();
    expect(b.categories.some((c) => c.id === m.id)).toBe(false);
    expect(b.categories.find((c) => c.name === 'Salons')!.parentId).toBe(fg.id);
    expect(b.budgets.find((x) => x.categoryId === fg.id && x.month === '2027-01-01')!.amount).toBe(1200);
  });

  it('suppression simple et catégorie TVA protégée', async () => {
    const r = await api('POST', '/categories', { name: 'Vide', flow: 'in' });
    expect((await api('DELETE', `/categories/${r.json().id}`)).statusCode).toBe(204);
    const vat = (await api('GET', '/bootstrap')).json().categories.find((c: { isVat: boolean }) => c.isVat);
    expect((await api('DELETE', `/categories/${vat.id}`)).statusCode).toBe(400);
  });

  it('fusion : opérations, règles et budgets suivent', async () => {
    const a = (await api('POST', '/categories', { name: 'Fournitures', flow: 'out' })).json();
    const b = (await api('POST', '/categories', { name: 'Petit matériel', flow: 'out' })).json();
    await api('POST', '/rules', { conditions: [{ field: 'label', operator: 'contains', value: 'BUREAU' }], categoryId: a.id, autoApply: false });
    await api('PUT', '/budgets', { changes: [{ scenarioId: 'base', categoryId: a.id, month: '2027-02-01', amount: 50 }, { scenarioId: 'base', categoryId: b.id, month: '2027-02-01', amount: 30 }] });
    const r = await api('POST', `/categories/${a.id}/merge`, { targetId: b.id });
    expect(r.statusCode).toBe(200);
    const boo = await boot();
    expect(boo.categories.some((c) => c.id === a.id)).toBe(false);
    expect(boo.rules.every((x) => x.categoryId !== a.id)).toBe(true);
    expect(boo.budgets.find((x) => x.categoryId === b.id && x.month === '2027-02-01')!.amount).toBe(80);
  });

  it('modèle sectoriel : ajoute les manquantes seulement', async () => {
    const r = await api('POST', '/categories/templates/btp');
    expect(r.statusCode).toBe(200);
    const names = r.json().added.map((c: Cat) => c.name);
    expect(names).toContain('Chantiers');
    expect(names).not.toContain('TVA');
    const again = await api('POST', '/categories/templates/btp');
    expect(again.json().added).toEqual([]);
  });
});
