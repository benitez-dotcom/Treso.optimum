import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { setCompanyContext, withTenant } from '../db';
import { ADMINS, audit, authenticate, loadCompany, requireRole, roleLabels, tenant, type Role } from '../context';
import { badRequest, conflict, forbidden, notFound } from '../errors';
import { templates } from '../mailer';
import { checkPasswordPolicy, hashPassword, randomToken, sha256 } from '../security';
import { createCompany } from '../services/company';

const roleEnum = z.enum(['ADMIN', 'EDITOR', 'ADVISOR', 'VIEWER']);

const companyBody = z.object({
  name: z.string().trim().min(1, "Indiquez le nom de l'entreprise.").max(120),
  siren: z
    .string()
    .trim()
    .regex(/^\d{9}$/, 'Le SIREN compte 9 chiffres.')
    .optional()
    .or(z.literal('').transform(() => undefined)),
  sector: z.string().trim().max(80).optional(),
  demo: z.boolean().default(false),
});

const settingsBody = z
  .object({
    name: z.string().trim().min(1).max(120),
    minCashThreshold: z.number().min(0).max(1e10),
    forecastMode: z.enum(['budget', 'projection']),
    invoicesEnabled: z.boolean(),
    vatEnabled: z.boolean(),
    vatRegime: z.enum(['monthly', 'quarterly']),
    overdueInPlan: z.enum(['current_month', 'due_month']),
    autoHideRefunds: z.boolean(),
    autoHideInternalTransfers: z.boolean(),
    fiscalYearStartMonth: z.number().int().min(1).max(12),
  })
  .partial()
  .strict();

const settingsColumns: Record<keyof z.infer<typeof settingsBody>, string> = {
  name: 'name',
  minCashThreshold: 'min_cash_threshold',
  forecastMode: 'forecast_mode',
  invoicesEnabled: 'invoices_enabled',
  vatEnabled: 'vat_enabled',
  vatRegime: 'vat_regime',
  overdueInPlan: 'overdue_in_plan',
  autoHideRefunds: 'auto_hide_refunds',
  autoHideInternalTransfers: 'auto_hide_internal_transfers',
  fiscalYearStartMonth: 'fiscal_year_start_month',
};

export interface CompanyRow {
  id: string;
  name: string;
  siren: string | null;
  sector: string | null;
  plan: string;
  trial_ends_at: Date | null;
  min_cash_threshold: number;
  forecast_mode: 'budget' | 'projection';
  invoices_enabled: boolean;
  vat_enabled: boolean;
  vat_regime: 'monthly' | 'quarterly';
  overdue_in_plan: 'current_month' | 'due_month';
  auto_hide_refunds: boolean;
  auto_hide_internal_transfers: boolean;
  fiscal_year_start_month: number;
  is_demo: boolean;
}

export const companyDto = (c: CompanyRow) => ({
  id: c.id,
  name: c.name,
  siren: c.siren,
  sector: c.sector,
  plan: c.plan,
  trialEndsAt: c.trial_ends_at,
  isDemo: c.is_demo,
  settings: {
    minCashThreshold: c.min_cash_threshold,
    forecastMode: c.forecast_mode,
    invoicesEnabled: c.invoices_enabled,
    vatEnabled: c.vat_enabled,
    vatRegime: c.vat_regime,
    overdueInPlan: c.overdue_in_plan,
    autoHideRefunds: c.auto_hide_refunds,
    autoHideInternalTransfers: c.auto_hide_internal_transfers,
    fiscalYearStartMonth: c.fiscal_year_start_month,
  },
});

export function registerAccountRoutes(app: FastifyInstance) {
  const { db, config, mailer } = app.deps;

  // ───────── Profil ─────────
  app.get('/me', { preHandler: authenticate }, async (req) => {
    return withTenant(db, { userId: req.userId! }, async (tx) => {
      const u = (
        await tx.query<{ id: string; email: string; first_name: string; last_name: string | null; theme: string; active_company_id: string | null }>(
          'SELECT id, email, first_name, last_name, theme, active_company_id FROM users WHERE id = $1',
          [req.userId],
        )
      ).rows[0];
      if (!u) throw notFound('user.not_found', 'Compte introuvable.');
      const companies = (
        await tx.query<{ id: string; name: string; plan: string; role: Role; is_demo: boolean }>(
          `SELECT c.id, c.name, c.plan, m.role, c.is_demo FROM memberships m JOIN companies c ON c.id = m.company_id
           WHERE m.user_id = $1 ORDER BY c.name`,
          [req.userId],
        )
      ).rows;
      return {
        id: u.id,
        email: u.email,
        firstName: u.first_name,
        lastName: u.last_name,
        theme: u.theme,
        activeCompanyId: companies.some((c) => c.id === u.active_company_id) ? u.active_company_id : null,
        companies: companies.map((c) => ({ id: c.id, name: c.name, plan: c.plan, role: c.role, roleLabel: roleLabels[c.role], isDemo: c.is_demo })),
      };
    });
  });

  app.patch('/me', { preHandler: authenticate }, async (req) => {
    const body = z
      .object({ firstName: z.string().trim().min(1).max(80), lastName: z.string().trim().max(80).nullable(), theme: z.enum(['light', 'dark', 'system']) })
      .partial()
      .strict()
      .parse(req.body);
    await db.query(
      `UPDATE users SET first_name = coalesce($2, first_name),
         last_name = CASE WHEN $5 THEN $3 ELSE last_name END,
         theme = coalesce($4, theme), updated_at = now() WHERE id = $1`,
      [req.userId, body.firstName ?? null, body.lastName ?? null, body.theme ?? null, 'lastName' in body],
    );
    return { ok: true };
  });

  app.put('/me/active-company', { preHandler: authenticate }, async (req) => {
    const { companyId } = z.object({ companyId: z.string().uuid() }).parse(req.body);
    await withTenant(db, { userId: req.userId! }, async (tx) => {
      const m = await tx.query('SELECT 1 FROM memberships WHERE user_id = $1 AND company_id = $2', [req.userId, companyId]);
      if (!m.rowCount) throw forbidden('company.not_member', "Vous n'avez pas accès à cette société.");
      await tx.query('UPDATE users SET active_company_id = $2, updated_at = now() WHERE id = $1', [req.userId, companyId]);
    });
    return { ok: true };
  });

  // ───────── Sociétés ─────────
  app.post('/companies', { preHandler: authenticate }, async (req, reply) => {
    const body = companyBody.parse(req.body);
    const id = await withTenant(db, { userId: req.userId! }, (tx) => createCompany(tx, req.userId!, body));
    return reply.status(201).send({ id });
  });

  app.get('/companies/current', { preHandler: loadCompany }, async (req) => {
    const c = await tenant(req, async (tx) => (await tx.query<CompanyRow>('SELECT * FROM companies WHERE id = $1', [req.company!.id])).rows[0]);
    if (!c) throw notFound();
    return { ...companyDto(c), role: req.company!.role };
  });

  app.patch('/companies/current', { preHandler: loadCompany }, async (req) => {
    requireRole(req, ADMINS);
    const body = settingsBody.parse(req.body);
    const entries = Object.entries(body) as [keyof typeof settingsColumns, unknown][];
    if (entries.length === 0) throw badRequest('validation.empty', 'Aucune modification.');
    return tenant(req, async (tx) => {
      const before = (await tx.query<CompanyRow>('SELECT * FROM companies WHERE id = $1', [req.company!.id])).rows[0]!;
      const sets = entries.map(([k], i) => `${settingsColumns[k]} = $${i + 2}`);
      const r = await tx.query<CompanyRow>(`UPDATE companies SET ${sets.join(', ')}, updated_at = now() WHERE id = $1 RETURNING *`, [
        req.company!.id,
        ...entries.map(([, v]) => v),
      ]);
      await audit(tx, req, 'update', 'company', req.company!.id, companyDto(before).settings, body);
      return companyDto(r.rows[0]!);
    });
  });

  app.delete('/companies/current', { preHandler: loadCompany }, async (req, reply) => {
    requireRole(req, ['OWNER']);
    const { confirmName } = z.object({ confirmName: z.string() }).parse(req.body ?? {});
    await tenant(req, async (tx) => {
      const c = (await tx.query<{ name: string }>('SELECT name FROM companies WHERE id = $1', [req.company!.id])).rows[0]!;
      if (c.name !== confirmName) throw badRequest('company.confirm_mismatch', "Saisissez exactement le nom de l'entreprise pour confirmer.");
      await tx.query('DELETE FROM companies WHERE id = $1', [req.company!.id]);
    });
    return reply.status(204).send();
  });

  // ───────── Membres ─────────
  app.get('/memberships', { preHandler: loadCompany }, async (req) => {
    return tenant(req, async (tx) => {
      const members = (
        await tx.query<{ user_id: string; email: string; first_name: string; last_name: string | null; role: Role; created_at: Date }>(
          `SELECT m.user_id, u.email, u.first_name, u.last_name, m.role, m.created_at
           FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.company_id = $1 ORDER BY m.created_at`,
          [req.company!.id],
        )
      ).rows;
      const invitations = ADMINS.includes(req.company!.role)
        ? (
            await tx.query<{ id: string; email: string; role: Role; expires_at: Date }>(
              'SELECT id, email, role, expires_at FROM invitations WHERE company_id = $1 AND accepted_at IS NULL AND expires_at > now() ORDER BY created_at DESC',
              [req.company!.id],
            )
          ).rows
        : [];
      return {
        members: members.map((m) => ({
          userId: m.user_id,
          email: m.email,
          name: [m.first_name, m.last_name].filter(Boolean).join(' '),
          role: m.role,
          roleLabel: roleLabels[m.role],
          isMe: m.user_id === req.userId,
        })),
        invitations: invitations.map((i) => ({ id: i.id, email: i.email, role: i.role, roleLabel: roleLabels[i.role], expiresAt: i.expires_at })),
      };
    });
  });

  app.patch('/memberships/:userId', { preHandler: loadCompany }, async (req) => {
    requireRole(req, ADMINS);
    const { userId } = z.object({ userId: z.string().uuid() }).parse(req.params);
    const { role } = z.object({ role: roleEnum }).parse(req.body);
    return tenant(req, async (tx) => {
      const target = (await tx.query<{ role: Role }>('SELECT role FROM memberships WHERE company_id = $1 AND user_id = $2', [req.company!.id, userId])).rows[0];
      if (!target) throw notFound('member.not_found', 'Ce membre est introuvable.');
      if (target.role === 'OWNER') throw forbidden('member.owner_locked', 'Le rôle du propriétaire ne peut pas être modifié.');
      await tx.query('UPDATE memberships SET role = $3 WHERE company_id = $1 AND user_id = $2', [req.company!.id, userId, role]);
      await audit(tx, req, 'update', 'membership', userId, { role: target.role }, { role });
      return { ok: true };
    });
  });

  app.delete('/memberships/:userId', { preHandler: loadCompany }, async (req, reply) => {
    const { userId } = z.object({ userId: z.string().uuid() }).parse(req.params);
    // Chacun peut quitter une société ; retirer quelqu'un d'autre demande d'être administrateur
    if (userId !== req.userId) requireRole(req, ADMINS);
    await tenant(req, async (tx) => {
      const target = (await tx.query<{ role: Role }>('SELECT role FROM memberships WHERE company_id = $1 AND user_id = $2', [req.company!.id, userId])).rows[0];
      if (!target) throw notFound('member.not_found', 'Ce membre est introuvable.');
      if (target.role === 'OWNER') throw forbidden('member.owner_locked', 'Le propriétaire ne peut pas quitter la société sans la transférer.');
      await tx.query('DELETE FROM memberships WHERE company_id = $1 AND user_id = $2', [req.company!.id, userId]);
      await audit(tx, req, 'delete', 'membership', userId, { role: target.role }, null);
    });
    return reply.status(204).send();
  });

  // ───────── Invitations ─────────
  app.post('/invitations', { preHandler: loadCompany }, async (req, reply) => {
    requireRole(req, ADMINS);
    const body = z.object({ email: z.string().trim().toLowerCase().email('Adresse email invalide.'), role: roleEnum }).parse(req.body);
    const token = randomToken();
    const info = await tenant(req, async (tx) => {
      const already = await tx.query(
        'SELECT 1 FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.company_id = $1 AND u.email = $2',
        [req.company!.id, body.email],
      );
      if (already.rowCount) throw conflict('invitation.already_member', 'Cette personne a déjà accès à la société.');
      await tx.query('DELETE FROM invitations WHERE company_id = $1 AND email = $2 AND accepted_at IS NULL', [req.company!.id, body.email]);
      await tx.query(
        `INSERT INTO invitations (company_id, email, role, token_hash, invited_by, expires_at)
         VALUES ($1, $2, $3, $4, $5, now() + interval '7 days')`,
        [req.company!.id, body.email, body.role, sha256(token), req.userId],
      );
      await audit(tx, req, 'create', 'invitation', body.email, null, { role: body.role });
      return (
        await tx.query<{ name: string; first_name: string }>(
          'SELECT c.name, u.first_name FROM companies c, users u WHERE c.id = $1 AND u.id = $2',
          [req.company!.id, req.userId],
        )
      ).rows[0]!;
    });
    const t = templates.invitation(config.appUrl, token, info.first_name, info.name, roleLabels[body.role]);
    await mailer.send({ to: body.email, ...t });
    return reply.status(201).send({ message: `Invitation envoyée à ${body.email}.`, ...(config.exposeEmailLinks ? { devLink: t.link } : {}) });
  });

  app.delete('/invitations/:id', { preHandler: loadCompany }, async (req, reply) => {
    requireRole(req, ADMINS);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    await tenant(req, (tx) => tx.query('DELETE FROM invitations WHERE id = $1 AND company_id = $2', [id, req.company!.id]));
    return reply.status(204).send();
  });

  /** Informations publiques d'une invitation (écran d'accueil de l'invité). */
  app.get('/invitations/:token', async (req) => {
    const { token } = z.object({ token: z.string().min(20).max(200) }).parse(req.params);
    const inv = (
      await db.query<{ company_name: string; email: string; role: Role; inviter: string | null; expires_at: Date; accepted_at: Date | null }>(
        'SELECT * FROM invitation_by_token($1)',
        [sha256(token)],
      )
    ).rows[0];
    if (!inv || inv.accepted_at || inv.expires_at.getTime() < Date.now()) {
      throw notFound('invitation.invalid', "Cette invitation a expiré ou a déjà été utilisée. Demandez-en une nouvelle à l'administrateur.");
    }
    const existing = await db.query('SELECT 1 FROM users WHERE email = $1', [inv.email]);
    return { companyName: inv.company_name, email: inv.email, role: inv.role, roleLabel: roleLabels[inv.role], inviter: inv.inviter, hasAccount: !!existing.rowCount };
  });

  /**
   * Accepter une invitation : connecté (même adresse email), ou en créant son
   * compte (prénom + mot de passe ; l'adresse est considérée comme vérifiée).
   */
  app.post('/invitations/:token/accept', async (req, reply) => {
    const { token } = z.object({ token: z.string().min(20).max(200) }).parse(req.params);
    const body = z.object({ firstName: z.string().trim().min(1).max(80).optional(), password: z.string().optional() }).parse(req.body ?? {});
    const inv = (
      await db.query<{ id: string; company_id: string; email: string; role: Role; expires_at: Date; accepted_at: Date | null }>(
        'SELECT * FROM invitation_by_token($1)',
        [sha256(token)],
      )
    ).rows[0];
    if (!inv || inv.accepted_at || inv.expires_at.getTime() < Date.now()) {
      throw notFound('invitation.invalid', "Cette invitation a expiré ou a déjà été utilisée. Demandez-en une nouvelle à l'administrateur.");
    }

    let userId: string;
    let created = false;
    if (req.headers.authorization) {
      await authenticate(req);
      const u = (await db.query<{ email: string }>('SELECT email FROM users WHERE id = $1', [req.userId])).rows[0];
      if (u?.email.toLowerCase() !== inv.email.toLowerCase()) {
        throw forbidden('invitation.email_mismatch', `Cette invitation est destinée à ${inv.email}. Connectez-vous avec cette adresse.`);
      }
      userId = req.userId!;
    } else {
      const existing = (await db.query<{ id: string }>('SELECT id FROM users WHERE email = $1', [inv.email])).rows[0];
      if (existing) throw forbidden('invitation.login_required', 'Un compte existe déjà pour cette adresse. Connectez-vous pour accepter.');
      if (!body.firstName || !body.password) throw badRequest('invitation.account_required', 'Indiquez votre prénom et un mot de passe.');
      checkPasswordPolicy(body.password, inv.email);
      const r = await db.query<{ id: string }>(
        'INSERT INTO users (email, password_hash, first_name, email_verified_at) VALUES ($1, $2, $3, now()) RETURNING id',
        [inv.email, await hashPassword(body.password), body.firstName],
      );
      userId = r.rows[0]!.id;
      created = true;
    }

    await withTenant(db, { userId, companyId: inv.company_id }, async (tx) => {
      await setCompanyContext(tx, inv.company_id);
      await tx.query(
        'INSERT INTO memberships (company_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT (company_id, user_id) DO NOTHING',
        [inv.company_id, userId, inv.role],
      );
      await tx.query('UPDATE invitations SET accepted_at = now() WHERE id = $1', [inv.id]);
      await tx.query('UPDATE users SET active_company_id = $2 WHERE id = $1', [userId, inv.company_id]);
    });
    return reply.status(200).send({ companyId: inv.company_id, accountCreated: created });
  });
}
