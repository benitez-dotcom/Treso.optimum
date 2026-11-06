import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { withTransaction, type Tx } from '../db';
import { ApiError, badRequest, unauthorized } from '../errors';
import { templates } from '../mailer';
import { checkPasswordPolicy, hashPassword, randomToken, sha256, signAccessToken, verifyPassword } from '../security';

export const REFRESH_COOKIE = 'treso_rt';
const COOKIE_PATH = '/api/v1/auth';

const email = z.string().trim().toLowerCase().email('Adresse email invalide.').max(254);

const signupBody = z.object({
  firstName: z.string().trim().min(1, 'Indiquez votre prénom.').max(80),
  email,
  password: z.string(),
  acceptTerms: z.literal(true, { errorMap: () => ({ message: "Acceptez les conditions d'utilisation pour continuer." }) }),
});
const loginBody = z.object({ email, password: z.string().min(1), remember: z.boolean().optional() });
const tokenBody = z.object({ token: z.string().min(20).max(200) });
const emailBody = z.object({ email });
const resetBody = z.object({ token: z.string().min(20).max(200), password: z.string() });

/** Empreinte factice : la vérification prend le même temps qu'un compte existe ou non. */
let dummyHash: Promise<string> | null = null;
const getDummyHash = () => (dummyHash ??= hashPassword('mot-de-passe-factice-pour-temps-constant'));

interface UserRow {
  id: string;
  email: string;
  password_hash: string | null;
  first_name: string;
  email_verified_at: string | null;
}

export async function createEmailToken(tx: Tx, userId: string, kind: 'verify' | 'reset' | 'magic', ttlMinutes: number): Promise<string> {
  const token = randomToken();
  await tx.query(`UPDATE email_tokens SET used_at = now() WHERE user_id = $1 AND kind = $2 AND used_at IS NULL`, [userId, kind]);
  await tx.query(`INSERT INTO email_tokens (user_id, kind, token_hash, expires_at) VALUES ($1, $2, $3, now() + make_interval(mins => $4))`, [
    userId,
    kind,
    sha256(token),
    ttlMinutes,
  ]);
  return token;
}

/** Consomme un jeton d'email à usage unique ; renvoie l'utilisateur concerné. */
async function consumeEmailToken(tx: Tx, token: string, kind: 'verify' | 'reset' | 'magic'): Promise<string> {
  const r = await tx.query<{ user_id: string }>(
    `UPDATE email_tokens SET used_at = now()
     WHERE token_hash = $1 AND kind = $2 AND used_at IS NULL AND expires_at > now()
     RETURNING user_id`,
    [sha256(token), kind],
  );
  const row = r.rows[0];
  if (!row) throw badRequest('auth.token_invalid', 'Ce lien a expiré ou a déjà été utilisé. Demandez-en un nouveau.');
  return row.user_id;
}

export function registerAuthRoutes(app: FastifyInstance) {
  const { db, config, mailer } = app.deps;
  const limit = config.env === 'test' ? {} : { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } };

  /** Ouvre une session : jeton d'accès (corps) + refresh token rotatif (cookie httpOnly). */
  async function issueSession(tx: Tx, req: FastifyRequest, reply: FastifyReply, userId: string, familyId?: string, remember = true) {
    const refresh = randomToken();
    const days = remember ? config.refreshTokenTtlDays : 1;
    await tx.query(
      `INSERT INTO refresh_tokens (user_id, family_id, token_hash, expires_at, user_agent)
       VALUES ($1, coalesce($2::uuid, gen_random_uuid()), $3, now() + make_interval(days => $4), $5)`,
      [userId, familyId ?? null, sha256(refresh), days, req.headers['user-agent']?.slice(0, 200) ?? null],
    );
    reply.setCookie(REFRESH_COOKIE, refresh, {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.cookieSecure,
      path: COOKIE_PATH,
      ...(remember ? { maxAge: days * 86_400 } : {}),
    });
    const accessToken = await signAccessToken(userId, config.jwtSecret, config.accessTokenTtlSeconds);
    return { accessToken, expiresIn: config.accessTokenTtlSeconds };
  }

  const devLink = (link: string) => (config.exposeEmailLinks ? { devLink: link } : {});

  app.post('/auth/signup', limit, async (req, reply) => {
    const body = signupBody.parse(req.body);
    checkPasswordPolicy(body.password, body.email);
    const passwordHash = await hashPassword(body.password);
    const result = await withTransaction(db, async (tx) => {
      const existing = await tx.query<UserRow>('SELECT * FROM users WHERE email = $1', [body.email]);
      let userId = existing.rows[0]?.id;
      if (existing.rows[0]?.email_verified_at) return null;
      if (!userId) {
        const r = await tx.query<{ id: string }>('INSERT INTO users (email, password_hash, first_name) VALUES ($1, $2, $3) RETURNING id', [
          body.email,
          passwordHash,
          body.firstName,
        ]);
        userId = r.rows[0]!.id;
      } else {
        await tx.query('UPDATE users SET password_hash = $2, first_name = $3, updated_at = now() WHERE id = $1', [userId, passwordHash, body.firstName]);
      }
      return createEmailToken(tx, userId, 'verify', 24 * 60);
    });
    // Même réponse que l'adresse soit nouvelle ou déjà utilisée (pas d'énumération des comptes)
    let link: string | undefined;
    if (result) {
      const t = templates.verify(config.appUrl, result);
      link = t.link;
      await mailer.send({ to: body.email, ...t });
    }
    return reply.status(201).send({ message: 'Vérifiez votre boîte mail pour activer votre compte.', ...(link ? devLink(link) : {}) });
  });

  app.post('/auth/email/resend', limit, async (req) => {
    const body = emailBody.parse(req.body);
    const token = await withTransaction(db, async (tx) => {
      const u = (await tx.query<UserRow>('SELECT * FROM users WHERE email = $1', [body.email])).rows[0];
      if (!u || u.email_verified_at) return null;
      return createEmailToken(tx, u.id, 'verify', 24 * 60);
    });
    let link: string | undefined;
    if (token) {
      const t = templates.verify(config.appUrl, token);
      link = t.link;
      await mailer.send({ to: body.email, ...t });
    }
    return { message: 'Si un compte non confirmé existe pour cette adresse, un nouvel email est parti.', ...(link ? devLink(link) : {}) };
  });

  app.post('/auth/email/verify', limit, async (req, reply) => {
    const { token } = tokenBody.parse(req.body);
    return withTransaction(db, async (tx) => {
      const userId = await consumeEmailToken(tx, token, 'verify');
      await tx.query('UPDATE users SET email_verified_at = coalesce(email_verified_at, now()), updated_at = now() WHERE id = $1', [userId]);
      return issueSession(tx, req, reply, userId);
    });
  });

  app.post('/auth/login', limit, async (req, reply) => {
    const body = loginBody.parse(req.body);
    const user = (await db.query<UserRow>('SELECT * FROM users WHERE email = $1', [body.email])).rows[0];
    // Vérification systématique pour un temps de réponse constant
    const ok = await verifyPassword(user?.password_hash ?? (await getDummyHash()), body.password);
    if (!user || !user.password_hash || !ok) throw new ApiError(401, 'auth.invalid_credentials', 'Email ou mot de passe incorrect.');
    if (!user.email_verified_at) {
      throw new ApiError(403, 'auth.email_not_verified', 'Confirmez d\'abord votre adresse : nous vous avons envoyé un email.');
    }
    return withTransaction(db, (tx) => issueSession(tx, req, reply, user.id, undefined, body.remember ?? true));
  });

  app.post('/auth/magic-link', limit, async (req) => {
    const body = emailBody.parse(req.body);
    const token = await withTransaction(db, async (tx) => {
      const u = (await tx.query<UserRow>('SELECT * FROM users WHERE email = $1 AND email_verified_at IS NOT NULL', [body.email])).rows[0];
      return u ? createEmailToken(tx, u.id, 'magic', 15) : null;
    });
    let link: string | undefined;
    if (token) {
      const t = templates.magic(config.appUrl, token);
      link = t.link;
      await mailer.send({ to: body.email, ...t });
    }
    return { message: 'Si un compte existe pour cette adresse, un lien de connexion vient de partir.', ...(link ? devLink(link) : {}) };
  });

  app.post('/auth/magic-link/verify', limit, async (req, reply) => {
    const { token } = tokenBody.parse(req.body);
    return withTransaction(db, async (tx) => {
      const userId = await consumeEmailToken(tx, token, 'magic');
      return issueSession(tx, req, reply, userId);
    });
  });

  app.post('/auth/password/forgot', limit, async (req) => {
    const body = emailBody.parse(req.body);
    const token = await withTransaction(db, async (tx) => {
      const u = (await tx.query<UserRow>('SELECT * FROM users WHERE email = $1', [body.email])).rows[0];
      return u ? createEmailToken(tx, u.id, 'reset', 60) : null;
    });
    let link: string | undefined;
    if (token) {
      const t = templates.reset(config.appUrl, token);
      link = t.link;
      await mailer.send({ to: body.email, ...t });
    }
    return { message: 'Si un compte existe pour cette adresse, un email de réinitialisation vient de partir.', ...(link ? devLink(link) : {}) };
  });

  app.post('/auth/password/reset', limit, async (req, reply) => {
    const body = resetBody.parse(req.body);
    return withTransaction(db, async (tx) => {
      const userId = await consumeEmailToken(tx, body.token, 'reset');
      const u = (await tx.query<UserRow>('SELECT * FROM users WHERE id = $1', [userId])).rows[0]!;
      checkPasswordPolicy(body.password, u.email);
      await tx.query('UPDATE users SET password_hash = $2, email_verified_at = coalesce(email_verified_at, now()), updated_at = now() WHERE id = $1', [
        userId,
        await hashPassword(body.password),
      ]);
      // Toutes les sessions existantes sont fermées
      await tx.query('UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [userId]);
      return issueSession(tx, req, reply, userId);
    });
  });

  /** Rotation du refresh token ; une réutilisation révoque toute la famille de sessions. */
  app.post('/auth/refresh', async (req, reply) => {
    const token = req.cookies[REFRESH_COOKIE];
    if (!token) throw unauthorized();
    const outcome = await withTransaction(db, async (tx) => {
      const r = await tx.query<{ id: string; user_id: string; family_id: string; revoked_at: Date | null; expires_at: Date; within_grace: boolean }>(
        `SELECT id, user_id, family_id, revoked_at, expires_at,
                coalesce(revoked_at > clock_timestamp() - make_interval(secs => $2::float / 1000), false) AS within_grace
         FROM refresh_tokens WHERE token_hash = $1 FOR UPDATE`,
        [sha256(token), config.refreshReuseGraceMs],
      );
      const row = r.rows[0];
      if (!row) return { kind: 'invalid' as const };
      // Deux onglets qui rafraîchissent en même temps : tolérance configurable
      const benignRace = row.revoked_at !== null && row.within_grace;
      if (row.revoked_at && !benignRace) {
        // Réutilisation d'un jeton déjà échangé : vol présumé, toute la famille est révoquée.
        // La révocation est validée (COMMIT) avant de renvoyer l'erreur.
        await tx.query('UPDATE refresh_tokens SET revoked_at = now() WHERE family_id = $1 AND revoked_at IS NULL', [row.family_id]);
        return { kind: 'reused' as const };
      }
      if (row.expires_at.getTime() < Date.now()) return { kind: 'invalid' as const };
      const session = await issueSession(tx, req, reply, row.user_id, row.family_id);
      if (!benignRace) {
        await tx.query(
          `UPDATE refresh_tokens SET revoked_at = now(),
             replaced_by = (SELECT id FROM refresh_tokens WHERE family_id = $2 AND id <> $1 ORDER BY created_at DESC LIMIT 1)
           WHERE id = $1`,
          [row.id, row.family_id],
        );
      }
      return { kind: 'ok' as const, session };
    });
    if (outcome.kind === 'ok') return outcome.session;
    reply.clearCookie(REFRESH_COOKIE, { path: COOKIE_PATH });
    if (outcome.kind === 'reused') throw unauthorized('auth.session_reused', 'Par sécurité, votre session a été fermée. Reconnectez-vous.');
    throw unauthorized();
  });

  app.post('/auth/logout', async (req, reply) => {
    const token = req.cookies[REFRESH_COOKIE];
    if (token) await db.query('UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL', [sha256(token)]);
    reply.clearCookie(REFRESH_COOKIE, { path: COOKIE_PATH });
    return reply.status(204).send();
  });
}
