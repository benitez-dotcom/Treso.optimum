import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { InjectOptions } from 'fastify';
import { withTenant } from '../src/db';
import { auth, refreshCookie, setup, signupAndLogin, teardown, tokenFromLink, type TestCtx } from './helpers';

let ctx: TestCtx;
beforeAll(async () => {
  ctx = await setup();
});
afterAll(async () => {
  await teardown(ctx);
});

const inject = (opts: InjectOptions) => ctx.app.inject(opts);

describe('authentification', () => {
  it('inscription → email non confirmé → vérification → connexion', async () => {
    const email = 'alice@exemple.fr';
    const s = await inject({ method: 'POST', url: '/api/v1/auth/signup', payload: { firstName: 'Alice', email, password: 'une phrase de passe solide', acceptTerms: true } });
    expect(s.statusCode).toBe(201);
    expect(ctx.mailer.last(email)?.subject).toContain('Confirmez');

    const early = await inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password: 'une phrase de passe solide' } });
    expect(early.statusCode).toBe(403);
    expect(early.json().code).toBe('auth.email_not_verified');

    const v = await inject({ method: 'POST', url: '/api/v1/auth/email/verify', payload: { token: tokenFromLink(s.json().devLink) } });
    expect(v.statusCode).toBe(200);
    expect(v.json().accessToken).toBeTruthy();
    expect(refreshCookie(v)).toBeTruthy();

    // Un lien de vérification ne sert qu'une fois
    const again = await inject({ method: 'POST', url: '/api/v1/auth/email/verify', payload: { token: tokenFromLink(s.json().devLink) } });
    expect(again.json().code).toBe('auth.token_invalid');

    const ok = await inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'ALICE@exemple.fr', password: 'une phrase de passe solide' } });
    expect(ok.statusCode).toBe(200);
    const bad = await inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password: 'mauvais mot de passe' } });
    expect(bad.statusCode).toBe(401);
    expect(bad.json().title).toBe('Email ou mot de passe incorrect.');
  });

  it('refuse les mots de passe faibles et valide les champs', async () => {
    const short = await inject({ method: 'POST', url: '/api/v1/auth/signup', payload: { firstName: 'B', email: 'b@exemple.fr', password: 'court', acceptTerms: true } });
    expect(short.json().code).toBe('auth.password_too_short');
    const terms = await inject({ method: 'POST', url: '/api/v1/auth/signup', payload: { firstName: 'B', email: 'b@exemple.fr', password: 'une phrase de passe solide' } });
    expect(terms.statusCode).toBe(422);
    expect(terms.headers['content-type']).toContain('application/problem+json');
  });

  it('rotation du refresh token et détection de réutilisation', async () => {
    await signupAndLogin(ctx.app, 'rota@exemple.fr');
    const login = await inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'rota@exemple.fr', password: 'une phrase de passe solide' } });
    const first = refreshCookie(login);
    const r1 = await inject({ method: 'POST', url: '/api/v1/auth/refresh', cookies: { treso_rt: first } });
    expect(r1.statusCode).toBe(200);
    const second = refreshCookie(r1);
    expect(second).not.toBe(first);

    // Rejouer l'ancien jeton : vol présumé, toute la famille est révoquée
    const replay = await inject({ method: 'POST', url: '/api/v1/auth/refresh', cookies: { treso_rt: first } });
    expect(replay.statusCode).toBe(401);
    expect(replay.json().code).toBe('auth.session_reused');
    const afterTheft = await inject({ method: 'POST', url: '/api/v1/auth/refresh', cookies: { treso_rt: second } });
    expect(afterTheft.statusCode).toBe(401);
  });

  it('lien magique et réinitialisation du mot de passe', async () => {
    await signupAndLogin(ctx.app, 'magic@exemple.fr');
    const m = await inject({ method: 'POST', url: '/api/v1/auth/magic-link', payload: { email: 'magic@exemple.fr' } });
    const mv = await inject({ method: 'POST', url: '/api/v1/auth/magic-link/verify', payload: { token: tokenFromLink(m.json().devLink) } });
    expect(mv.statusCode).toBe(200);

    // Adresse inconnue : même réponse, pas de lien
    const unknown = await inject({ method: 'POST', url: '/api/v1/auth/password/forgot', payload: { email: 'personne@exemple.fr' } });
    expect(unknown.statusCode).toBe(200);
    expect(unknown.json().devLink).toBeUndefined();

    const f = await inject({ method: 'POST', url: '/api/v1/auth/password/forgot', payload: { email: 'magic@exemple.fr' } });
    const r = await inject({ method: 'POST', url: '/api/v1/auth/password/reset', payload: { token: tokenFromLink(f.json().devLink), password: 'nouvelle phrase de passe' } });
    expect(r.statusCode).toBe(200);
    const login = await inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'magic@exemple.fr', password: 'nouvelle phrase de passe' } });
    expect(login.statusCode).toBe(200);
  });

  it('refuse un jeton d\'accès absent ou falsifié', async () => {
    expect((await inject({ method: 'GET', url: '/api/v1/me' })).statusCode).toBe(401);
    expect((await inject({ method: 'GET', url: '/api/v1/me', headers: auth('faux.jeton.signe') })).statusCode).toBe(401);
  });
});

describe('sociétés, données et isolation', () => {
  let ownerToken: string;
  let otherToken: string;
  let companyId: string;

  beforeAll(async () => {
    ownerToken = await signupAndLogin(ctx.app, 'owner@exemple.fr', 'Jérôme');
    otherToken = await signupAndLogin(ctx.app, 'intrus@exemple.fr', 'Ivan');
  });

  it('crée une société de démonstration et charge ses données', async () => {
    const c = await inject({ method: 'POST', url: '/api/v1/companies', headers: auth(ownerToken), payload: { name: 'Atelier Démo', demo: true } });
    expect(c.statusCode).toBe(201);
    companyId = c.json().id;
    const me = await inject({ method: 'GET', url: '/api/v1/me', headers: auth(ownerToken) });
    expect(me.json().activeCompanyId).toBe(companyId);
    expect(me.json().companies[0].role).toBe('OWNER');

    const b = await inject({ method: 'GET', url: '/api/v1/bootstrap', headers: auth(ownerToken) });
    expect(b.statusCode).toBe(200);
    const data = b.json();
    expect(data.categories.length).toBeGreaterThan(10);
    expect(data.transactions.length).toBeGreaterThan(200);
    expect(data.scenarios.find((s: { isBase: boolean }) => s.isBase)).toBeTruthy();
    expect(typeof data.transactions[0].amount).toBe('number');
    expect(data.transactions[0].bookedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('une société normale démarre avec les catégories par défaut et un scénario de base', async () => {
    const t = await signupAndLogin(ctx.app, 'neuve@exemple.fr');
    await inject({ method: 'POST', url: '/api/v1/companies', headers: auth(t), payload: { name: 'SARL Neuve', siren: '732829320' } });
    const data = (await inject({ method: 'GET', url: '/api/v1/bootstrap', headers: auth(t) })).json();
    expect(data.company.name).toBe('SARL Neuve');
    expect(data.transactions).toHaveLength(0);
    expect(data.scenarios).toEqual([{ id: 'base', name: 'Scénario de base', color: '#114C5C', isBase: true, description: null, archived: false }]);
  });

  it('un autre utilisateur ne voit rien de la société (API)', async () => {
    const sw = await inject({ method: 'PUT', url: '/api/v1/me/active-company', headers: auth(otherToken), payload: { companyId } });
    expect(sw.statusCode).toBe(403);
    const b = await inject({ method: 'GET', url: '/api/v1/bootstrap', headers: auth(otherToken) });
    expect(b.statusCode).toBe(403);
    expect(b.json().code).toBe('company.none');
  });

  it('RLS : même en SQL direct, le rôle applicatif ne lit que la société du contexte', async () => {
    const other = await inject({ method: 'POST', url: '/api/v1/companies', headers: auth(otherToken), payload: { name: 'Autre SAS' } });
    const otherCompany = other.json().id as string;
    const intruder = (await ctx.db.query<{ id: string }>("SELECT id FROM users WHERE email = 'intrus@exemple.fr'")).rows[0]!.id;

    // Sans contexte : aucune ligne visible
    expect((await ctx.db.query('SELECT * FROM transactions')).rowCount).toBe(0);

    await withTenant(ctx.db, { userId: intruder, companyId: otherCompany }, async (tx) => {
      expect((await tx.query('SELECT * FROM transactions WHERE company_id = $1', [companyId])).rowCount).toBe(0);
      expect((await tx.query('SELECT * FROM companies WHERE id = $1', [companyId])).rowCount).toBe(0);
      // Écrire dans une autre société est refusé par la politique WITH CHECK
      await expect(
        tx.query("INSERT INTO scenarios (company_id, id, name, color) VALUES ($1, 'pirate', 'Pirate', '#000000')", [companyId]),
      ).rejects.toThrow(/row-level security/);
    });
  });

  it('enregistre des budgets, crée un scénario et journalise', async () => {
    const put = await inject({
      method: 'PUT',
      url: '/api/v1/budgets',
      headers: auth(ownerToken),
      payload: { changes: [{ scenarioId: 'base', categoryId: 'ventes', month: '2027-06-01', amount: 31000 }] },
    });
    expect(put.statusCode).toBe(200);
    const neg = await inject({
      method: 'PUT',
      url: '/api/v1/budgets',
      headers: auth(ownerToken),
      payload: { changes: [{ scenarioId: 'base', categoryId: 'ventes', month: '2027-06-01', amount: -5 }] },
    });
    expect(neg.statusCode).toBe(422);

    const sc = await inject({ method: 'POST', url: '/api/v1/scenarios', headers: auth(ownerToken), payload: { name: 'Prudent', color: '#C2410C', copyFrom: 'base' } });
    expect(sc.statusCode).toBe(201);
    const data = (await inject({ method: 'GET', url: '/api/v1/bootstrap', headers: auth(ownerToken) })).json();
    const copied = data.budgets.filter((b: { scenarioId: string }) => b.scenarioId === sc.json().id);
    expect(copied.length).toBeGreaterThan(50);
    expect(data.budgets.find((b: { scenarioId: string; month: string; categoryId: string }) => b.scenarioId === 'base' && b.month === '2027-06-01' && b.categoryId === 'ventes').amount).toBe(31000);

    const logs = await inject({ method: 'GET', url: '/api/v1/audit-logs', headers: auth(ownerToken) });
    expect(logs.json().map((l: { entity: string }) => l.entity)).toEqual(expect.arrayContaining(['budgets', 'scenario']));
  });

  it('catégorise des opérations et confirme un rapprochement', async () => {
    const data = (await inject({ method: 'GET', url: '/api/v1/bootstrap', headers: auth(ownerToken) })).json();
    const tx = data.transactions.find((t: { rawLabel: string }) => t.rawLabel.includes('FA-2026-108'));
    const inv = data.commitments.find((c: { number: string }) => c.number === 'FA-2026-108');
    const rec = await inject({ method: 'POST', url: '/api/v1/reconciliations', headers: auth(ownerToken), payload: { transactionId: tx.id, commitmentId: inv.id } });
    expect(rec.statusCode).toBe(200);
    expect(rec.json().status).toBe('paid');

    const uncat = data.transactions.filter((t: { categoryId: string | null; hidden: boolean }) => !t.categoryId && !t.hidden).slice(0, 2);
    const batch = await inject({
      method: 'POST',
      url: '/api/v1/transactions/batch',
      headers: auth(ownerToken),
      payload: { ops: uncat.map((t: { id: string }) => ({ id: t.id, categoryId: 'banque' })) },
    });
    expect(batch.json().updated).toBe(2);
  });
});

describe('rôles et invitations', () => {
  let ownerToken: string;
  let companyId: string;

  beforeAll(async () => {
    ownerToken = await signupAndLogin(ctx.app, 'patron@exemple.fr', 'Paul');
    companyId = (await inject({ method: 'POST', url: '/api/v1/companies', headers: auth(ownerToken), payload: { name: 'Menuiserie Paul', demo: true } })).json().id;
  });

  it('invite un lecteur qui crée son compte, puis ne peut rien modifier', async () => {
    const inv = await inject({ method: 'POST', url: '/api/v1/invitations', headers: auth(ownerToken), payload: { email: 'lecteur@exemple.fr', role: 'VIEWER' } });
    expect(inv.statusCode).toBe(201);
    const token = tokenFromLink(inv.json().devLink);

    const info = await inject({ method: 'GET', url: `/api/v1/invitations/${token}` });
    expect(info.json()).toMatchObject({ companyName: 'Menuiserie Paul', role: 'VIEWER', roleLabel: 'Lecteur', inviter: 'Paul', hasAccount: false });

    const acc = await inject({ method: 'POST', url: `/api/v1/invitations/${token}/accept`, payload: { firstName: 'Léa', password: 'lecture seule sans risque' } });
    expect(acc.statusCode).toBe(200);
    expect(acc.json()).toEqual({ companyId, accountCreated: true });

    const login = await inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'lecteur@exemple.fr', password: 'lecture seule sans risque' } });
    const viewer = login.json().accessToken as string;
    expect((await inject({ method: 'GET', url: '/api/v1/bootstrap', headers: auth(viewer) })).statusCode).toBe(200);

    const write = await inject({
      method: 'PUT',
      url: '/api/v1/budgets',
      headers: auth(viewer),
      payload: { changes: [{ scenarioId: 'base', categoryId: 'ventes', month: '2027-01-01', amount: 1 }] },
    });
    expect(write.statusCode).toBe(403);
    expect((await inject({ method: 'POST', url: '/api/v1/invitations', headers: auth(viewer), payload: { email: 'x@exemple.fr', role: 'ADMIN' } })).statusCode).toBe(403);

    // Une invitation ne sert qu'une fois
    expect((await inject({ method: 'GET', url: `/api/v1/invitations/${token}` })).statusCode).toBe(404);
  });

  it('un conseiller modifie un scénario alternatif mais pas le scénario de base', async () => {
    const inv = await inject({ method: 'POST', url: '/api/v1/invitations', headers: auth(ownerToken), payload: { email: 'conseil@exemple.fr', role: 'ADVISOR' } });
    await inject({ method: 'POST', url: `/api/v1/invitations/${tokenFromLink(inv.json().devLink)}/accept`, payload: { firstName: 'Coralie', password: 'aide au pilotage sûre' } });
    const advisor = (await inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'conseil@exemple.fr', password: 'aide au pilotage sûre' } })).json().accessToken as string;

    const base = await inject({ method: 'PUT', url: '/api/v1/budgets', headers: auth(advisor), payload: { changes: [{ scenarioId: 'base', categoryId: 'ventes', month: '2027-01-01', amount: 1 }] } });
    expect(base.statusCode).toBe(403);
    const alt = await inject({ method: 'PUT', url: '/api/v1/budgets', headers: auth(advisor), payload: { changes: [{ scenarioId: 'recrutement', categoryId: 'ventes', month: '2027-01-01', amount: 1 }] } });
    expect(alt.statusCode).toBe(200);
  });

  it('gère les rôles et protège le propriétaire', async () => {
    const list = (await inject({ method: 'GET', url: '/api/v1/memberships', headers: auth(ownerToken) })).json();
    expect(list.members.map((m: { roleLabel: string }) => m.roleLabel)).toEqual(['Propriétaire', 'Lecteur', 'Conseiller Optimum']);
    const viewer = list.members.find((m: { role: string }) => m.role === 'VIEWER');
    const up = await inject({ method: 'PATCH', url: `/api/v1/memberships/${viewer.userId}`, headers: auth(ownerToken), payload: { role: 'EDITOR' } });
    expect(up.statusCode).toBe(200);
    const owner = list.members.find((m: { role: string }) => m.role === 'OWNER');
    const demote = await inject({ method: 'PATCH', url: `/api/v1/memberships/${owner.userId}`, headers: auth(ownerToken), payload: { role: 'VIEWER' } });
    expect(demote.statusCode).toBe(403);
  });

  it('met à jour les paramètres de la société', async () => {
    const p = await inject({ method: 'PATCH', url: '/api/v1/companies/current', headers: auth(ownerToken), payload: { minCashThreshold: 20000, forecastMode: 'budget' } });
    expect(p.statusCode).toBe(200);
    expect(p.json().settings).toMatchObject({ minCashThreshold: 20000, forecastMode: 'budget' });
    const bad = await inject({ method: 'PATCH', url: '/api/v1/companies/current', headers: auth(ownerToken), payload: { plan: 'FIRM' } });
    expect(bad.statusCode).toBe(422);
  });
});
