import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';
import { renderEmailHtml } from '../src/mailer';
import { setup, teardown, type TestCtx } from './helpers';

describe('garde-fous de production', () => {
  const smtp = { host: 'ssl0.ovh.net', port: 465, secure: true, user: 'no-reply@exemple.fr', pass: 'x', from: 'Tréso <no-reply@exemple.fr>' };
  it('refuse d’exposer les liens des emails en production', () => {
    expect(() => loadConfig({ env: 'production', jwtSecret: 'x'.repeat(40), exposeEmailLinks: true, smtp })).toThrow(/EXPOSE_EMAIL_LINKS/);
  });
  it('exige un serveur SMTP en production', () => {
    expect(() => loadConfig({ env: 'production', jwtSecret: 'x'.repeat(40), exposeEmailLinks: false, smtp: null })).toThrow(/SMTP/);
    expect(() => loadConfig({ env: 'production', jwtSecret: 'x'.repeat(40), exposeEmailLinks: false, smtp })).not.toThrow();
  });
  it('échappe le contenu des emails HTML', () => {
    const html = renderEmailHtml({ to: 'a@b.fr', subject: '<b>Test</b>', text: 'Bonjour "Paul"', link: 'https://x.fr/?a=1&b=2' }, 'https://treso.exemple.fr');
    expect(html).toContain('&lt;b&gt;Test&lt;/b&gt;');
    expect(html).toContain('https://x.fr/?a=1&amp;b=2');
    expect(html).not.toContain('<b>Test</b>');
  });
});

describe('inscription réservée à certains domaines', () => {
  let ctx: TestCtx;
  beforeAll(async () => {
    ctx = await setup({ signupAllowedDomains: ['optimumgestion.fr'] });
  });
  afterAll(async () => {
    await teardown(ctx);
  });
  const signup = (email: string) =>
    ctx.app.inject({ method: 'POST', url: '/api/v1/auth/signup', payload: { firstName: 'Test', email, password: 'une phrase de passe solide', acceptTerms: true } });

  it('accepte une adresse du domaine autorisé', async () => {
    expect((await signup('jerome@optimumgestion.fr')).statusCode).toBe(201);
  });
  it('refuse les autres adresses', async () => {
    const r = await signup('inconnu@gmail.com');
    expect(r.statusCode).toBe(403);
    expect(r.json().code).toBe('auth.signup_closed');
  });
});
