import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { InjectOptions } from 'fastify';
import { auth, setup, signupAndLogin, teardown, type TestCtx } from './helpers';

let ctx: TestCtx;
let token: string;
const api = (method: InjectOptions['method'], url: string, payload?: unknown, t = token) =>
  ctx.app.inject({ method, url: `/api/v1${url}`, headers: auth(t), ...(payload !== undefined ? { payload: payload as InjectOptions['payload'] } : {}) });

type Boot = {
  scenarios: { id: string; name: string; color: string; isBase: boolean; description: string | null; archived: boolean }[];
  indicators: { id: string; name: string; formula: string; unit: string; format: string; position: number }[];
  budgetNotes: { scenarioId: string; categoryId: string; month: string; note: string }[];
  budgets: { scenarioId: string; categoryId: string; month: string; amount: number }[];
  company: { settings: { fiscalYearStartMonth: number } };
};
const boot = async () => (await api('GET', '/bootstrap')).json() as Boot;

beforeAll(async () => {
  ctx = await setup();
  token = await signupAndLogin(ctx.app, 'plan@exemple.fr', 'Claire');
  await api('POST', '/companies', { name: 'Atelier Plan' });
});
afterAll(async () => {
  await teardown(ctx);
});

describe('scénarios', () => {
  let altId: string;

  it('crée un scénario avec description', async () => {
    const r = await api('POST', '/scenarios', { name: 'Recrutement en mars', color: '#8A6FB0', description: 'Un commercial en CDI.' });
    expect(r.statusCode).toBe(201);
    altId = r.json().id;
    expect(r.json()).toMatchObject({ description: 'Un commercial en CDI.', archived: false });
  });

  it('renomme, change la couleur et archive', async () => {
    const r = await api('PATCH', `/scenarios/${altId}`, { name: 'Recrutement en avril', color: '#F28C38' });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ name: 'Recrutement en avril', color: '#F28C38', description: 'Un commercial en CDI.' });
    expect((await api('PATCH', `/scenarios/${altId}`, { archived: true })).json().archived).toBe(true);
    const s = (await boot()).scenarios.find((x) => x.id === altId)!;
    expect(s.archived).toBe(true);
    expect((await api('PATCH', `/scenarios/${altId}`, { description: null })).json().description).toBeNull();
  });

  it('le scénario de base ne peut pas être archivé', async () => {
    const r = await api('PATCH', '/scenarios/base', { archived: true });
    expect(r.statusCode).toBe(400);
    expect(r.json().code).toBe('scenario.base_locked');
  });

  it('refuse une modification vide ou une couleur invalide', async () => {
    expect((await api('PATCH', `/scenarios/${altId}`, {})).statusCode).toBe(400);
    expect((await api('PATCH', `/scenarios/${altId}`, { color: 'rouge' })).statusCode).toBe(422);
    expect((await api('PATCH', '/scenarios/inconnu', { name: 'x' })).statusCode).toBe(404);
  });
});

describe('commentaires de cellule', () => {
  it('ajoute, modifie puis supprime un commentaire', async () => {
    const cell = { scenarioId: 'base', categoryId: 'ventes', month: '2027-03-01' };
    const r = await api('PUT', '/budget-notes', { ...cell, note: 'Salon professionnel : +30 %' });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ ...cell, note: 'Salon professionnel : +30 %' });
    await api('PUT', '/budget-notes', { ...cell, note: 'Salon reporté' });
    expect((await boot()).budgetNotes).toEqual([expect.objectContaining({ ...cell, note: 'Salon reporté' })]);
    await api('PUT', '/budget-notes', { ...cell, note: null });
    expect((await boot()).budgetNotes).toEqual([]);
  });

  it('refuse une catégorie inconnue', async () => {
    const r = await api('PUT', '/budget-notes', { scenarioId: 'base', categoryId: 'nope', month: '2027-03-01', note: 'x' });
    expect(r.statusCode).toBe(404);
  });
});

describe('indicateurs', () => {
  let id: string;

  it('crée un indicateur dont la formule référence des catégories', async () => {
    const r = await api('POST', '/indicators', {
      name: 'Marge brute',
      formula: '([Ventes] - [Achats et sous-traitance]) / [ventes] * 100',
      unit: '%',
      format: 'percent',
    });
    expect(r.statusCode).toBe(201);
    id = r.json().id;
    expect(r.json()).toMatchObject({ name: 'Marge brute', unit: '%', format: 'percent', position: 1 });
  });

  it('valide la formule et le nom', async () => {
    const bad = await api('POST', '/indicators', { name: 'Test', formula: '([Ventes] + 2' });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().title).toBe('Parenthèse fermante manquante.');
    const unknown = await api('POST', '/indicators', { name: 'Test', formula: '[Chiffre magique] * 2' });
    expect(unknown.json().title).toBe('Catégorie inconnue : « Chiffre magique ».');
    const dup = await api('POST', '/indicators', { name: 'Marge brute', formula: '[Encaissements] - [Décaissements]' });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().title).toBe('Un indicateur porte déjà ce nom.');
    const unit = await api('POST', '/indicators', { name: 'Unité longue', formula: '[Solde fin]', unit: 'euros' });
    expect(unit.statusCode).toBe(422);
  });

  it('modifie, ordonne puis supprime', async () => {
    const other = (await api('POST', '/indicators', { name: 'Flux net', formula: '[Encaissements] - [Décaissements]', unit: '€', format: 'currency' })).json();
    expect((await api('PATCH', `/indicators/${id}`, { name: 'Marge' })).json().name).toBe('Marge');
    expect((await api('PATCH', `/indicators/${other.id}`, { name: 'Marge' })).statusCode).toBe(409);
    expect((await api('PATCH', `/indicators/${id}`, { formula: '[Inconnue]' })).statusCode).toBe(400);
    await api('PUT', '/indicators/order', { ids: [other.id, id] });
    expect((await boot()).indicators.map((i) => i.name)).toEqual(['Flux net', 'Marge']);
    expect((await api('DELETE', `/indicators/${id}`)).statusCode).toBe(204);
    expect((await api('DELETE', `/indicators/${id}`)).statusCode).toBe(404);
  });
});

describe('réglages du plan', () => {
  it('début d’exercice', async () => {
    expect((await boot()).company.settings.fiscalYearStartMonth).toBe(1);
    const r = await api('PATCH', '/companies/current', { fiscalYearStartMonth: 7 });
    expect(r.statusCode).toBe(200);
    expect((await boot()).company.settings.fiscalYearStartMonth).toBe(7);
    expect((await api('PATCH', '/companies/current', { fiscalYearStartMonth: 13 })).statusCode).toBe(422);
  });
});
