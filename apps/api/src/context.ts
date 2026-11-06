import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Config } from './config';
import type { Db, Tx } from './db';
import { withTenant } from './db';
import { forbidden, unauthorized } from './errors';
import type { Mailer } from './mailer';
import { verifyAccessToken } from './security';

export type Role = 'OWNER' | 'ADMIN' | 'EDITOR' | 'ADVISOR' | 'VIEWER';

export const roleLabels: Record<Role, string> = {
  OWNER: 'Propriétaire',
  ADMIN: 'Administrateur',
  EDITOR: 'Contributeur',
  ADVISOR: 'Conseiller Optimum',
  VIEWER: 'Lecteur',
};

/** Rôles autorisés à modifier les données métier. */
export const WRITERS: Role[] = ['OWNER', 'ADMIN', 'EDITOR'];
/** Rôles autorisés à gérer les membres et les paramètres. */
export const ADMINS: Role[] = ['OWNER', 'ADMIN'];

export interface Deps {
  db: Db;
  config: Config;
  mailer: Mailer;
}

declare module 'fastify' {
  interface FastifyInstance {
    deps: Deps;
  }
  interface FastifyRequest {
    userId?: string;
    company?: { id: string; role: Role };
  }
}

/** Vérifie le jeton d'accès (`Authorization: Bearer …`). */
export async function authenticate(req: FastifyRequest): Promise<void> {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) throw unauthorized();
  const claims = await verifyAccessToken(header.slice(7), req.server.deps.config.jwtSecret);
  if (!claims) throw unauthorized();
  req.userId = claims.sub;
}

/** Charge la société active de l'utilisateur et son rôle dans cette société. */
export async function loadCompany(req: FastifyRequest): Promise<void> {
  await authenticate(req);
  const userId = req.userId!;
  const row = await withTenant(req.server.deps.db, { userId }, async (tx) => {
    const r = await tx.query<{ company_id: string; role: Role }>(
      `SELECT m.company_id, m.role FROM users u
       JOIN memberships m ON m.user_id = u.id AND m.company_id = u.active_company_id
       WHERE u.id = $1`,
      [userId],
    );
    return r.rows[0];
  });
  if (!row) throw forbidden('company.none', 'Aucune société active. Créez ou choisissez une société.');
  req.company = { id: row.company_id, role: row.role };
}

export function requireRole(req: FastifyRequest, roles: Role[]): void {
  if (!req.company || !roles.includes(req.company.role)) {
    throw forbidden('auth.forbidden', "Votre rôle ne permet pas cette action. Demandez l'accès à un administrateur.");
  }
}

/** Transaction dans le contexte RLS de la société active. */
export function tenant<T>(req: FastifyRequest, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withTenant(req.server.deps.db, { userId: req.userId!, companyId: req.company?.id ?? null }, fn);
}

export async function audit(
  tx: Tx,
  req: FastifyRequest,
  action: string,
  entity: string,
  entityId: string | null,
  before: unknown,
  after: unknown,
): Promise<void> {
  await tx.query(
    'INSERT INTO audit_logs (company_id, actor_id, action, entity, entity_id, before, after) VALUES ($1, $2, $3, $4, $5, $6, $7)',
    [req.company!.id, req.userId, action, entity, entityId, before === undefined ? null : JSON.stringify(before), after === undefined ? null : JSON.stringify(after)],
  );
}

export type Handler = (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
