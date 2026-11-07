import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { InjectOptions } from 'fastify';
import { auth, setup, signupAndLogin, teardown, type TestCtx } from './helpers';

let ctx: TestCtx;
let token: string;
const api = (method: InjectOptions['method'], url: string, payload?: unknown) =>
  ctx.app.inject({ method, url: `/api/v1${url}`, headers: auth(token), ...(payload !== undefined ? { payload: payload as InjectOptions['payload'] } : {}) });

type Line = { account: string; label: string; debit: number; credit: number };
type Entry = { id: string; status: string; journal: string; number: number | null; sourceType: string; lines: Line[] };

beforeAll(async () => {
  ctx = await setup();
  token = await signupAndLogin(ctx.app, 'compta@exemple.fr', 'Claire');
  await api('POST', '/companies', { name: 'Atelier Compta', demo: true });
});
afterAll(async () => teardown(ctx));

describe('pré-comptabilité', () => {
  let entries: Entry[] = [];

  it('crée le plan de comptes par défaut au premier accès', async () => {
    const r = (await api('GET', '/precompta')).json();
    expect(r.chart.some((a: { number: string }) => a.number === '401000')).toBe(true);
    expect(r.settings.journals.sales).toBe('VT');
    expect(r.entries).toEqual([]);
  });

  it('génère les écritures de la période depuis les factures et les opérations', async () => {
    const r = await api('POST', '/precompta/generate', { from: '2000-01-01', to: '2100-12-31' });
    expect(r.statusCode).toBe(200);
    expect(r.json().generated).toBeGreaterThan(10);
    entries = r.json().entries;
    expect(entries.every((e) => e.status === 'draft')).toBe(true);
    const again = await api('POST', '/precompta/generate', { from: '2000-01-01', to: '2100-12-31' });
    expect(again.json().generated).toBe(0);
  });

  it('une écriture déséquilibrée ne peut pas être validée', async () => {
    const e = entries.find((x) => x.sourceType === 'commitment')!;
    const lines = e.lines.map((l, i) => (i === 0 ? { ...l, debit: l.debit ? l.debit + 12.4 : 0, credit: l.credit ? l.credit + 12.4 : 0 } : l));
    expect((await api('PATCH', `/precompta/entries/${e.id}`, { lines })).statusCode).toBe(200);
    const v = (await api('POST', '/precompta/entries/validate', { ids: [e.id] })).json();
    expect(v.validated).toBe(0);
    expect(v.refused[0].errors).toContain('Écart de 12,40 € entre débit et crédit');
    await api('PATCH', `/precompta/entries/${e.id}`, { lines: e.lines });
    expect((await api('POST', '/precompta/entries/validate', { ids: [e.id] })).json().validated).toBe(1);
  });

  it('valide en série avec une numérotation continue par journal, puis verrouille', async () => {
    const ids = entries.slice(0, 8).map((e) => e.id);
    const v = (await api('POST', '/precompta/entries/validate', { ids })).json();
    const done = (v.entries as Entry[]).filter((e) => e.status === 'validated');
    for (const j of new Set(done.map((e) => e.journal))) {
      const nums = done.filter((e) => e.journal === j).map((e) => e.number!).sort((a, b) => a - b);
      expect(nums).toEqual(nums.map((_, i) => i + 1));
    }
    expect((await api('PATCH', `/precompta/entries/${done[0]!.id}`, { label: 'x' })).statusCode).toBe(400);
  });

  it('refus avec motif', async () => {
    const draft = entries.find((e) => e.status === 'draft' && !entries.slice(0, 8).some((x) => x.id === e.id))!;
    expect((await api('POST', '/precompta/entries/reject', { ids: [draft.id], reason: '' })).statusCode).toBe(422);
    const r = (await api('POST', '/precompta/entries/reject', { ids: [draft.id], reason: 'Pièce manquante' })).json();
    expect(r.entries.find((e: Entry & { rejectedReason: string }) => e.id === draft.id)).toMatchObject({ status: 'rejected', rejectedReason: 'Pièce manquante' });
  });

  it('FEC : contrôle de conformité (SIREN) puis fichier de 18 colonnes', async () => {
    const bad = (await api('GET', '/precompta/fec?from=2000-01-01&to=2100-12-31')).json();
    expect(bad.errors).toContain('SIREN manquant ou invalide : renseignez-le dans Paramètres › Société.');
    expect((await api('PATCH', '/companies/current', { siren: '552100554' })).statusCode).toBe(200);
    const ok = (await api('GET', '/precompta/fec?from=2000-01-01&to=2100-12-31&closing=2026-12-31')).json();
    expect(ok.errors).toEqual([]);
    expect(ok.fileName).toBe('552100554FEC20261231.txt');
    const rows = ok.content.trim().split('\r\n');
    expect(rows.every((r: string) => r.split('|').length === 18)).toBe(true);
  });

  it('envoi : les écritures validées passent en « Envoyées »', async () => {
    const all = (await api('GET', '/precompta')).json().entries as Entry[];
    const ids = all.filter((e) => e.status === 'validated').map((e) => e.id);
    expect((await api('POST', '/precompta/entries/send', { ids })).json().sent).toBe(ids.length);
  });

  it('correspondances et réglages', async () => {
    const cats = (await api('GET', '/bootstrap')).json().categories;
    expect((await api('PUT', '/precompta/mappings', { items: [{ categoryId: cats[0].id, account: '706100' }] })).statusCode).toBe(200);
    expect((await api('GET', '/precompta')).json().mappings[cats[0].id]).toBe('706100');
    const s = (await api('PUT', '/precompta/settings', { provider: 'other', software: 'Quadra' })).json();
    expect(s.software).toBe('Quadra');
    expect((await api('POST', '/precompta/connection/test')).json().message).toMatch(/Quadra/);
  });
});
