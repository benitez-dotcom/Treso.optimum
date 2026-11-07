import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Budget, Category } from '@optimum/treso-engine';
import { audit, loadCompany, requireRole, tenant, WRITERS, type Role } from '../context';
import { badRequest, forbidden, notFound } from '../errors';
import { companyDto, type CompanyRow } from './account';
import { accountDto, connectionDto } from './banking';
import { toRule, toTransaction } from '../services/operations';
import { toCommitment, toReconciliation } from '../services/commitments';
import { indicatorDto, noteDto, scenarioDto } from './plan';

const monthKey = z.string().regex(/^\d{4}-\d{2}-01$/, 'Mois invalide (format AAAA-MM-01).');
const amount = z.number().min(0, 'Un budget ne peut pas être négatif.').max(1e10).nullable();

/** Les conseillers peuvent modifier les scénarios alternatifs, pas le scénario de base. */
const SCENARIO_WRITERS: Role[] = [...WRITERS, 'ADVISOR'];

type Row = Record<string, unknown>;

const toCategory = (r: Row): Category => ({
  id: r.id as string,
  name: r.name as string,
  flow: r.flow as Category['flow'],
  parentId: (r.parent_id as string | null) ?? null,
  position: r.position as number,
  kind: r.kind as Category['kind'],
  vatRate: r.vat_rate as number,
  budgetAtParent: r.budget_at_parent as boolean,
  isVat: r.is_vat as boolean,
  isSystem: r.is_system as boolean,
  defaultAccountId: (r.default_account_id as string | null) ?? null,
});



export function registerDataRoutes(app: FastifyInstance) {
  /** Toutes les données de la société active, pour hydrater l'application. */
  app.get('/bootstrap', { preHandler: loadCompany }, async (req) => {
    return tenant(req, async (tx) => {
      const q = (sql: string) => tx.query<Row>(sql).then((r) => r.rows);
      const company = (await tx.query<Row>('SELECT * FROM companies WHERE id = $1', [req.company!.id])).rows[0];
      if (!company) throw notFound();
      const [connections, accounts, categories, transactions, commitments, scenarios, budgets, rules, indicators, notes, reconciliations] = await Promise.all([
        q('SELECT * FROM bank_connections ORDER BY created_at'),
        q('SELECT * FROM bank_accounts ORDER BY is_manual, name'),
        q('SELECT * FROM categories ORDER BY flow, position'),
        q('SELECT * FROM transactions ORDER BY booked_at, id'),
        q('SELECT * FROM commitments ORDER BY due_at'),
        q('SELECT * FROM scenarios ORDER BY is_base DESC, name'),
        q("SELECT scenario_id, category_id, to_char(month, 'YYYY-MM-DD') AS month, amount FROM budgets"),
        q('SELECT * FROM rules ORDER BY priority DESC'),
        q('SELECT * FROM indicators ORDER BY position, name'),
        q("SELECT scenario_id, category_id, to_char(month, 'YYYY-MM-DD') AS month, note, updated_at FROM budget_notes"),
        q('SELECT * FROM reconciliations ORDER BY created_at'),
      ]);
      return {
        company: companyDto(company as unknown as CompanyRow),
        role: req.company!.role,
        connections: connections.map(connectionDto),
        accounts: accounts.map(accountDto),
        categories: categories.map(toCategory),
        transactions: transactions.map(toTransaction),
        commitments: commitments.map(toCommitment),
        scenarios: scenarios.map(scenarioDto),
        budgets: budgets.map((b): Budget => ({ scenarioId: b.scenario_id as string, categoryId: b.category_id as string, month: b.month as string, amount: b.amount as number })),
        rules: rules.map(toRule),
        indicators: indicators.map(indicatorDto),
        budgetNotes: notes.map(noteDto),
        reconciliations: reconciliations.map(toReconciliation),
      };
    });
  });

  // ───────── Budgets ─────────
  app.put('/budgets', { preHandler: loadCompany }, async (req) => {
    requireRole(req, SCENARIO_WRITERS);
    const { changes } = z
      .object({ changes: z.array(z.object({ scenarioId: z.string(), categoryId: z.string(), month: monthKey, amount })).min(1).max(2000) })
      .parse(req.body);
    return tenant(req, async (tx) => {
      const scenarioIds = [...new Set(changes.map((c) => c.scenarioId))];
      const sc = await tx.query<{ id: string; is_base: boolean }>('SELECT id, is_base FROM scenarios WHERE id = ANY($1)', [scenarioIds]);
      if (sc.rowCount !== scenarioIds.length) throw notFound('scenario.not_found', 'Scénario introuvable.');
      if (req.company!.role === 'ADVISOR' && sc.rows.some((s) => s.is_base)) {
        throw forbidden('scenario.base_locked', 'Les conseillers modifient les scénarios alternatifs, pas le scénario de base.');
      }
      for (const c of changes) {
        if (c.amount === null) {
          await tx.query('DELETE FROM budgets WHERE company_id = $1 AND scenario_id = $2 AND category_id = $3 AND month = $4', [
            req.company!.id, c.scenarioId, c.categoryId, c.month,
          ]);
        } else {
          await tx.query(
            `INSERT INTO budgets (company_id, scenario_id, category_id, month, amount) VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (company_id, scenario_id, category_id, month) DO UPDATE SET amount = excluded.amount`,
            [req.company!.id, c.scenarioId, c.categoryId, c.month, c.amount],
          );
        }
      }
      await audit(tx, req, 'update', 'budgets', null, null, { count: changes.length, sample: changes.slice(0, 5) });
      return { updated: changes.length };
    });
  });

  // ───────── Scénarios ─────────
  app.post('/scenarios', { preHandler: loadCompany }, async (req, reply) => {
    requireRole(req, SCENARIO_WRITERS);
    const body = z
      .object({
        name: z.string().trim().min(1, 'Donnez un nom à votre scénario.').max(80),
        color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
        description: z.string().trim().max(500).optional(),
        copyFrom: z.string().optional(),
      })
      .parse(req.body);
    const id = `sc-${randomUUID().slice(0, 8)}`;
    await tenant(req, async (tx) => {
      await tx.query('INSERT INTO scenarios (company_id, id, name, color, is_base, description) VALUES ($1, $2, $3, $4, false, $5)', [
        req.company!.id, id, body.name, body.color, body.description || null,
      ]);
      if (body.copyFrom) {
        await tx.query(
          `INSERT INTO budgets (company_id, scenario_id, category_id, month, amount)
           SELECT company_id, $2, category_id, month, amount FROM budgets WHERE company_id = $1 AND scenario_id = $3`,
          [req.company!.id, id, body.copyFrom],
        );
      }
      await audit(tx, req, 'create', 'scenario', id, null, body);
    });
    return reply.status(201).send({ id, name: body.name, color: body.color, isBase: false, description: body.description || null, archived: false });
  });

  app.delete('/scenarios/:id', { preHandler: loadCompany }, async (req, reply) => {
    requireRole(req, SCENARIO_WRITERS);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    await tenant(req, async (tx) => {
      const s = (await tx.query<{ is_base: boolean; name: string }>('SELECT is_base, name FROM scenarios WHERE id = $1', [id])).rows[0];
      if (!s) throw notFound('scenario.not_found', 'Scénario introuvable.');
      if (s.is_base) throw badRequest('scenario.base_locked', 'Le scénario de base ne peut pas être supprimé.');
      await tx.query('DELETE FROM scenarios WHERE id = $1', [id]);
      await audit(tx, req, 'delete', 'scenario', id, { name: s.name }, null);
    });
    return reply.status(204).send();
  });

  // ───────── Journal d'activité ─────────
  app.get('/audit-logs', { preHandler: loadCompany }, async (req) => {
    requireRole(req, ['OWNER', 'ADMIN']);
    const { limit } = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) }).parse(req.query);
    return tenant(req, async (tx) => {
      const rows = (
        await tx.query<Row>(
          `SELECT a.id, a.action, a.entity, a.entity_id, a.before, a.after, a.at, u.first_name
           FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id ORDER BY a.at DESC, a.id DESC LIMIT $1`,
          [limit],
        )
      ).rows;
      return rows.map((r) => ({ id: r.id, action: r.action, entity: r.entity, entityId: r.entity_id, before: r.before, after: r.after, at: r.at, actor: r.first_name }));
    });
  });
}
