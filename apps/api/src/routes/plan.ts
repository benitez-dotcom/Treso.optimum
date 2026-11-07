/**
 * Plan de trésorerie (lot 3) : scénarios (renommer, couleur, description,
 * archivage), commentaires de cellule et indicateurs personnalisés.
 */
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { FormulaError, indicatorResolver, parseFormula } from '@optimum/treso-engine';
import { audit, loadCompany, requireRole, tenant, WRITERS, type Role } from '../context';
import type { Tx } from '../db';
import { badRequest, conflict, forbidden, notFound } from '../errors';

const SCENARIO_WRITERS: Role[] = [...WRITERS, 'ADVISOR'];
const monthKey = z.string().regex(/^\d{4}-\d{2}-01$/, 'Mois invalide (format AAAA-MM-01).');
const color = z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Couleur invalide.');

type Row = Record<string, unknown>;

export const scenarioDto = (s: Row) => ({
  id: s.id as string,
  name: s.name as string,
  color: s.color as string,
  isBase: s.is_base as boolean,
  description: (s.description as string | null) ?? null,
  archived: (s.archived as boolean) ?? false,
});

export const indicatorDto = (i: Row) => ({
  id: i.id as string,
  name: i.name as string,
  formula: i.formula as string,
  unit: i.unit as string,
  format: (i.format as string) ?? 'number',
  decimals: (i.decimals as number) ?? 2,
  position: (i.position as number) ?? 0,
});

export const noteDto = (n: Row) => ({
  scenarioId: n.scenario_id as string,
  categoryId: n.category_id as string,
  month: n.month as string,
  note: n.note as string,
  updatedAt: n.updated_at as string,
});

/** Vérifie la formule contre les catégories de la société ; renvoie le message d'erreur. */
async function checkFormula(tx: Tx, formula: string): Promise<void> {
  const cats = (await tx.query<{ id: string; name: string }>('SELECT id, name FROM categories')).rows;
  try {
    parseFormula(formula, indicatorResolver(cats));
  } catch (e) {
    throw badRequest('indicator.formula_invalid', e instanceof FormulaError ? e.message : 'Formule invalide.');
  }
}

const isUniqueViolation = (e: unknown) => (e as { code?: string }).code === '23505';
const duplicateName = () => conflict('indicator.name_taken', 'Un indicateur porte déjà ce nom.');

const indicatorBody = z.object({
  name: z.string().trim().min(1, 'Donnez un nom à votre indicateur.').max(80),
  formula: z.string().trim().min(1, 'Saisissez une formule.').max(1000),
  unit: z.string().trim().max(3, 'L’unité tient en 3 caractères maximum.').default(''),
  format: z.enum(['number', 'currency', 'percent']).default('number'),
  decimals: z.number().int().min(0).max(2).default(2),
});

export function registerPlanRoutes(app: FastifyInstance) {
  // ───────── Scénarios ─────────
  app.patch('/scenarios/:id', { preHandler: loadCompany }, async (req) => {
    requireRole(req, SCENARIO_WRITERS);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const body = z
      .object({
        name: z.string().trim().min(1, 'Donnez un nom à votre scénario.').max(80),
        color,
        description: z.string().trim().max(500).nullable(),
        archived: z.boolean(),
      })
      .partial()
      .strict()
      .parse(req.body);
    if (Object.keys(body).length === 0) throw badRequest('validation.empty', 'Aucune modification.');
    return tenant(req, async (tx) => {
      const before = (await tx.query<Row>('SELECT * FROM scenarios WHERE id = $1', [id])).rows[0];
      if (!before) throw notFound('scenario.not_found', 'Scénario introuvable.');
      if (body.archived && before.is_base) throw badRequest('scenario.base_locked', 'Le scénario de base ne peut pas être archivé.');
      if (req.company!.role === 'ADVISOR' && before.is_base) {
        throw forbidden('scenario.base_locked', 'Les conseillers modifient les scénarios alternatifs, pas le scénario de base.');
      }
      const after = (
        await tx.query<Row>(
          `UPDATE scenarios SET name = COALESCE($2, name), color = COALESCE($3, color),
             description = CASE WHEN $4 THEN $5 ELSE description END, archived = COALESCE($6, archived)
           WHERE id = $1 RETURNING *`,
          [id, body.name ?? null, body.color ?? null, 'description' in body, body.description || null, body.archived ?? null],
        )
      ).rows[0]!;
      await audit(tx, req, 'update', 'scenario', id, scenarioDto(before), scenarioDto(after));
      return scenarioDto(after);
    });
  });

  // ───────── Commentaires de cellule ─────────
  app.put('/budget-notes', { preHandler: loadCompany }, async (req) => {
    requireRole(req, SCENARIO_WRITERS);
    const body = z
      .object({
        scenarioId: z.string(),
        categoryId: z.string(),
        month: monthKey,
        note: z.string().trim().max(1000, 'Le commentaire tient en 1 000 caractères.').nullable(),
      })
      .parse(req.body);
    return tenant(req, async (tx) => {
      if (!body.note) {
        await tx.query('DELETE FROM budget_notes WHERE scenario_id = $1 AND category_id = $2 AND month = $3', [body.scenarioId, body.categoryId, body.month]);
        return { ...body, note: null };
      }
      const exists = await tx.query(
        'SELECT 1 FROM scenarios s, categories c WHERE s.id = $1 AND c.id = $2',
        [body.scenarioId, body.categoryId],
      );
      if (!exists.rowCount) throw notFound('budget_note.not_found', 'Scénario ou catégorie introuvable.');
      const r = await tx.query<Row>(
        `INSERT INTO budget_notes (company_id, scenario_id, category_id, month, note, author_id) VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (company_id, scenario_id, category_id, month) DO UPDATE SET note = excluded.note, author_id = excluded.author_id, updated_at = now()
         RETURNING scenario_id, category_id, to_char(month, 'YYYY-MM-DD') AS month, note, updated_at`,
        [req.company!.id, body.scenarioId, body.categoryId, body.month, body.note, req.userId],
      );
      await audit(tx, req, 'update', 'budget_note', `${body.scenarioId}|${body.categoryId}|${body.month}`, null, { note: body.note });
      return noteDto(r.rows[0]!);
    });
  });

  // ───────── Indicateurs ─────────
  app.post('/indicators', { preHandler: loadCompany }, async (req, reply) => {
    requireRole(req, WRITERS);
    const body = indicatorBody.parse(req.body);
    const id = `ind-${randomUUID().slice(0, 8)}`;
    try {
      const created = await tenant(req, async (tx) => {
        await checkFormula(tx, body.formula);
        const pos = (await tx.query<{ p: number }>('SELECT COALESCE(max(position), 0) + 1 AS p FROM indicators')).rows[0]!.p;
        const r = await tx.query<Row>(
          `INSERT INTO indicators (company_id, id, name, formula, unit, format, decimals, position)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
          [req.company!.id, id, body.name, body.formula, body.unit, body.format, body.decimals, pos],
        );
        await audit(tx, req, 'create', 'indicator', id, null, body);
        return indicatorDto(r.rows[0]!);
      });
      return reply.status(201).send(created);
    } catch (e) {
      if (isUniqueViolation(e)) throw duplicateName();
      throw e;
    }
  });

  app.patch('/indicators/:id', { preHandler: loadCompany }, async (req) => {
    requireRole(req, WRITERS);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const body = indicatorBody.partial().strict().parse(req.body);
    try {
      return await tenant(req, async (tx) => {
        const before = (await tx.query<Row>('SELECT * FROM indicators WHERE id = $1', [id])).rows[0];
        if (!before) throw notFound('indicator.not_found', 'Indicateur introuvable.');
        if (body.formula) await checkFormula(tx, body.formula);
        const r = await tx.query<Row>(
          `UPDATE indicators SET name = COALESCE($2, name), formula = COALESCE($3, formula), unit = COALESCE($4, unit),
             format = COALESCE($5, format), decimals = COALESCE($6, decimals) WHERE id = $1 RETURNING *`,
          [id, body.name ?? null, body.formula ?? null, body.unit ?? null, body.format ?? null, body.decimals ?? null],
        );
        await audit(tx, req, 'update', 'indicator', id, indicatorDto(before), body);
        return indicatorDto(r.rows[0]!);
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw duplicateName();
      throw e;
    }
  });

  app.put('/indicators/order', { preHandler: loadCompany }, async (req) => {
    requireRole(req, WRITERS);
    const { ids } = z.object({ ids: z.array(z.string()).max(200) }).parse(req.body);
    await tenant(req, async (tx) => {
      for (const [i, id] of ids.entries()) await tx.query('UPDATE indicators SET position = $2 WHERE id = $1', [id, i + 1]);
    });
    return { ok: true };
  });

  app.delete('/indicators/:id', { preHandler: loadCompany }, async (req, reply) => {
    requireRole(req, WRITERS);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    await tenant(req, async (tx) => {
      const before = (await tx.query<Row>('DELETE FROM indicators WHERE id = $1 RETURNING *', [id])).rows[0];
      if (!before) throw notFound('indicator.not_found', 'Indicateur introuvable.');
      await audit(tx, req, 'delete', 'indicator', id, indicatorDto(before), null);
    });
    return reply.status(204).send();
  });
}
