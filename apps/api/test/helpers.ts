import pg from 'pg';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import { createPool, type Db } from '../src/db';
import { MemoryMailer } from '../src/mailer';
import { migrate } from '../src/migrate';

export const OWNER_URL = process.env.TEST_DATABASE_OWNER_URL ?? 'postgres://treso_owner:treso@localhost:5432/treso_test';
export const APP_URL = process.env.TEST_DATABASE_URL ?? 'postgres://treso_app:treso_app@localhost:5432/treso_test';

export interface TestCtx {
  app: FastifyInstance;
  db: Db;
  mailer: MemoryMailer;
}

/** Base de test vierge : on supprime toutes les données puis on (ré)applique les migrations. */
export async function setup(): Promise<TestCtx> {
  await migrate(OWNER_URL, 'treso_app', () => undefined);
  const owner = new pg.Client({ connectionString: OWNER_URL });
  await owner.connect();
  await owner.query('TRUNCATE users, companies, refresh_tokens, email_tokens RESTART IDENTITY CASCADE');
  await owner.end();
  const db = createPool(APP_URL);
  const mailer = new MemoryMailer();
  const config = loadConfig({ env: 'test', databaseUrl: APP_URL, databaseOwnerUrl: OWNER_URL, exposeEmailLinks: true, refreshReuseGraceMs: 0 });
  const app = await buildApp({ config, db, mailer });
  return { app, db, mailer };
}

export async function teardown(ctx: TestCtx) {
  await ctx.app.close();
  await ctx.db.end();
}

export const tokenFromLink = (link: string) => new URL(link).searchParams.get('token')!;

export function refreshCookie(res: { cookies: { name: string; value: string }[] }): string {
  const c = res.cookies.find((x) => x.name === 'treso_rt');
  if (!c) throw new Error('cookie de session absent');
  return c.value;
}

/** Inscrit, confirme et connecte un utilisateur ; renvoie son jeton d'accès. */
export async function signupAndLogin(app: FastifyInstance, email: string, firstName = 'Test'): Promise<string> {
  const s = await app.inject({ method: 'POST', url: '/api/v1/auth/signup', payload: { firstName, email, password: 'une phrase de passe solide', acceptTerms: true } });
  if (s.statusCode !== 201) throw new Error(`signup ${s.statusCode} ${s.body}`);
  const v = await app.inject({ method: 'POST', url: '/api/v1/auth/email/verify', payload: { token: tokenFromLink(s.json().devLink) } });
  if (v.statusCode !== 200) throw new Error(`verify ${v.statusCode} ${v.body}`);
  return v.json().accessToken as string;
}

export const auth = (token: string) => ({ authorization: `Bearer ${token}` });
