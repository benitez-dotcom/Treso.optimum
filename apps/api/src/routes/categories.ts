/**
 * Catégories (écran 7.9) : création, modification, déplacement avec
 * conséquences sur les budgets, fusion, suppression avec déplacement,
 * modèles sectoriels.
 */
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  CATEGORY_TEMPLATES,
  moveBudgetChanges,
  moveConsequence,
  moveError,
  nameTaken,
  reorderSiblings,
  subtreeIds,
  templateAdditions,
  transferBudgets,
  type Budget,
  type Category,
} from '@optimum/treso-engine';
import { audit, loadCompany, requireRole, tenant, WRITERS } from '../context';
import type { Tx } from '../db';
import { badRequest, conflict, notFound } from '../errors';
import { toCategory } from './data';

type Row = Record<string, unknown>;

const KINDS = ['revenue', 'purchases', 'overheads', 'payroll', 'none'] as const;
const VAT = z.number().refine((v) => [0, 2.1, 5.5, 10, 20].includes(v), 'Taux de TVA invalide.');
const color = z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Couleur invalide.');
const name = z.string().trim().min(1, 'Donnez un nom à la catégorie.').max(80, 'Le nom tient en 80 caractères.');

const newId = () => `cat-${randomUUID().slice(0, 8)}`;

async function loadAll(tx: Tx): Promise<Category[]> {
  return (await tx.query<Row>('SELECT * FROM categories')).rows.map(toCategory);
}

async function loadBudgets(tx: Tx): Promise<Budget[]> {
  return (await tx.query<Row>("SELECT scenario_id, category_id, to_char(month, 'YYYY-MM-DD') AS month, amount FROM budgets")).rows.map((b) => ({
    scenarioId: b.scenario_id as string,
    categoryId: b.category_id as string,
    month: b.month as string,
    amount: Number(b.amount),
  }));
}

async function writeBudgets(tx: Tx, companyId: string, changes: Budget[]) {
  for (const c of changes) {
    if (c.amount === null) await tx.query('DELETE FROM budgets WHERE scenario_id = $1 AND category_id = $2 AND month = $3', [c.scenarioId, c.categoryId, c.month]);
    else
      await tx.query(
        `INSERT INTO budgets (company_id, scenario_id, category_id, month, amount) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (company_id, scenario_id, category_id, month) DO UPDATE SET amount = excluded.amount`,
        [companyId, c.scenarioId, c.categoryId, c.month, c.amount],
      );
  }
}

/** Nombre d'éléments rattachés (pour proposer « Déplacer vers… » plutôt que bloquer). */
async function usage(tx: Tx, ids: string[]) {
  const q = async (sql: string) => Number((await tx.query<{ n: string }>(sql, [ids])).rows[0]!.n);
  return {
    transactions: await q('SELECT count(*) AS n FROM transactions WHERE category_id = ANY($1)'),
    commitments: await q('SELECT count(*) AS n FROM commitments WHERE category_id = ANY($1)'),
    budgets: await q('SELECT count(*) AS n FROM budgets WHERE category_id = ANY($1)'),
    rules: await q('SELECT count(*) AS n FROM rules WHERE category_id = ANY($1)'),
  };
}

/**
 * Transfère tout ce qui est rattaché à `sourceId` vers `targetId` (opérations,
 * factures, règles, budgets additionnés, commentaires, sous-catégories), puis
 * supprime `sourceId`.
 */
async function mergeInto(tx: Tx, companyId: string, all: Category[], sourceId: string, targetId: string) {
  const source = all.find((c) => c.id === sourceId)!;
  const target = all.find((c) => c.id === targetId);
  if (!target) throw notFound('category.not_found', 'Catégorie de destination introuvable.');
  if (target.flow !== source.flow) throw badRequest('category.flow', 'Choisissez une catégorie du même sens.');
  if (subtreeIds(all, sourceId).includes(targetId)) throw badRequest('category.cycle', 'Choisissez une catégorie qui n’est pas une sous-catégorie de celle-ci.');
  if (target.isVat && all.some((c) => c.parentId === sourceId)) throw badRequest('category.vat_parent', 'La catégorie de la TVA ne peut pas avoir de sous-catégorie.');

  await tx.query('UPDATE transactions SET category_id = $2 WHERE category_id = $1', [sourceId, targetId]);
  await tx.query("UPDATE transactions SET suggestion = NULL WHERE suggestion->>'categoryId' = $1", [sourceId]);
  await tx.query('UPDATE commitments SET category_id = $2 WHERE category_id = $1', [sourceId, targetId]);
  await tx.query('UPDATE rules SET category_id = $2 WHERE category_id = $1', [sourceId, targetId]);
  await writeBudgets(tx, companyId, transferBudgets(await loadBudgets(tx), [sourceId], targetId));
  await tx.query(
    `INSERT INTO budget_notes (company_id, scenario_id, category_id, month, note, author_id, updated_at)
     SELECT company_id, scenario_id, $2, month, note, author_id, updated_at FROM budget_notes WHERE category_id = $1
     ON CONFLICT DO NOTHING`,
    [sourceId, targetId],
  );
  const maxPos = Number((await tx.query<{ p: string }>('SELECT coalesce(max(position), 0) AS p FROM categories WHERE parent_id = $1', [targetId])).rows[0]!.p);
  await tx.query('UPDATE categories SET parent_id = $2, position = position + $3 WHERE parent_id = $1', [sourceId, targetId, maxPos]);
  await tx.query('DELETE FROM categories WHERE id = $1', [sourceId]);
}

const updatable = z
  .object({
    name,
    kind: z.enum(KINDS),
    vatRate: VAT,
    icon: z.string().max(40).nullable(),
    color: color.nullable(),
    note: z.string().trim().max(500).nullable(),
    budgetAtParent: z.boolean(),
    defaultAccountId: z.string().nullable(),
    /** Reporter le compte par défaut sur les factures non payées de la catégorie. */
    applyAccountToOpenInvoices: z.boolean(),
  })
  .partial()
  .strict();

export function registerCategoryRoutes(app: FastifyInstance) {
  app.post('/categories', { preHandler: loadCompany }, async (req, reply) => {
    requireRole(req, WRITERS);
    const body = z
      .object({
        name,
        flow: z.enum(['in', 'out']),
        parentId: z.string().nullable().default(null),
        kind: z.enum(KINDS).default('none'),
        vatRate: VAT.default(0),
        icon: z.string().max(40).nullable().default(null),
        color: color.nullable().default(null),
        note: z.string().trim().max(500).nullable().default(null),
      })
      .parse(req.body);
    const created = await tenant(req, async (tx) => {
      const all = await loadAll(tx);
      if (body.parentId) {
        const parent = all.find((c) => c.id === body.parentId);
        if (!parent) throw notFound('category.not_found', 'Catégorie parente introuvable.');
        if (parent.flow !== body.flow) throw badRequest('category.flow', 'Une sous-catégorie garde le sens de sa catégorie parente.');
        if (parent.isVat) throw badRequest('category.vat_parent', 'La catégorie de la TVA ne peut pas avoir de sous-catégorie.');
      }
      if (nameTaken(all, body.name, body.flow, body.parentId)) throw conflict('category.name_taken', `Une catégorie « ${body.name} » existe déjà à cet endroit.`);
      const id = newId();
      const position = Math.max(0, ...all.filter((c) => c.flow === body.flow && c.parentId === body.parentId).map((c) => c.position)) + 1;
      const r = await tx.query<Row>(
        `INSERT INTO categories (company_id, id, name, flow, parent_id, position, kind, vat_rate, icon, color, note)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
        [req.company!.id, id, body.name, body.flow, body.parentId, position, body.kind, body.vatRate, body.icon, body.color, body.note || null],
      );
      await audit(tx, req, 'create', 'category', id, null, body);
      return toCategory(r.rows[0]!);
    });
    return reply.status(201).send(created);
  });

  app.patch('/categories/:id', { preHandler: loadCompany }, async (req) => {
    requireRole(req, WRITERS);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const body = updatable.parse(req.body);
    return tenant(req, async (tx) => {
      const all = await loadAll(tx);
      const before = all.find((c) => c.id === id);
      if (!before) throw notFound('category.not_found', 'Catégorie introuvable.');
      if (body.name && nameTaken(all, body.name, before.flow, before.parentId, id)) throw conflict('category.name_taken', `Une catégorie « ${body.name} » existe déjà à cet endroit.`);
      if (body.defaultAccountId) {
        const a = await tx.query('SELECT 1 FROM bank_accounts WHERE id = $1', [body.defaultAccountId]);
        if (!a.rowCount) throw notFound('account.not_found', 'Compte introuvable.');
      }
      const cols: Record<string, string> = {
        name: 'name', kind: 'kind', vatRate: 'vat_rate', icon: 'icon', color: 'color', note: 'note', budgetAtParent: 'budget_at_parent', defaultAccountId: 'default_account_id',
      };
      const sets: string[] = [];
      const values: unknown[] = [id];
      for (const [k, col] of Object.entries(cols)) {
        if (!(k in body)) continue;
        values.push(k === 'note' ? (body.note || null) : body[k as keyof typeof body]);
        sets.push(`${col} = $${values.length}`);
      }
      let after = before;
      if (sets.length) after = toCategory((await tx.query<Row>(`UPDATE categories SET ${sets.join(', ')} WHERE id = $1 RETURNING *`, values)).rows[0]!);
      let invoicesUpdated = 0;
      if (body.applyAccountToOpenInvoices && 'defaultAccountId' in body) {
        invoicesUpdated =
          (await tx.query("UPDATE commitments SET account_id = $2 WHERE category_id = $1 AND status = 'pending' AND coalesce(amount_paid, 0) < amount_incl_tax", [id, body.defaultAccountId]))
            .rowCount ?? 0;
      }
      await audit(tx, req, 'update', 'category', id, before, body);
      return { ...after, invoicesUpdated };
    });
  });

  /** Aperçu des conséquences d'un déplacement sur les budgets. */
  app.post('/categories/:id/move-preview', { preHandler: loadCompany }, async (req) => {
    requireRole(req, WRITERS);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const { parentId } = z.object({ parentId: z.string().nullable() }).parse(req.body);
    return tenant(req, async (tx) => {
      const all = await loadAll(tx);
      const err = moveError(all, id, parentId);
      if (err) throw badRequest('category.move', err);
      return moveConsequence(all, await loadBudgets(tx), id, parentId);
    });
  });

  /** Déplacer ou réordonner (glisser-déposer). */
  app.post('/categories/:id/move', { preHandler: loadCompany }, async (req) => {
    requireRole(req, WRITERS);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const body = z
      .object({ parentId: z.string().nullable(), index: z.number().int().min(0), budgets: z.enum(['sum', 'delete']).optional() })
      .parse(req.body);
    return tenant(req, async (tx) => {
      const all = await loadAll(tx);
      const cat = all.find((c) => c.id === id);
      if (!cat) throw notFound('category.not_found', 'Catégorie introuvable.');
      const err = moveError(all, id, body.parentId);
      if (err) throw badRequest('category.move', err);
      if (body.parentId !== cat.parentId && nameTaken(all, cat.name, cat.flow, body.parentId, id)) {
        throw conflict('category.name_taken', `Une catégorie « ${cat.name} » existe déjà à cet endroit.`);
      }
      if (body.parentId && body.parentId !== cat.parentId) {
        const budgets = await loadBudgets(tx);
        const consequence = moveConsequence(all, budgets, id, body.parentId);
        if (consequence.kind !== 'none') {
          if (!body.budgets) throw conflict('category.move_budgets', consequence.message);
          await writeBudgets(tx, req.company!.id, moveBudgetChanges(all, budgets, id, body.parentId, body.budgets));
        }
      }
      const positions = reorderSiblings(all, id, body.parentId, body.index);
      for (const p of positions) await tx.query('UPDATE categories SET parent_id = $2, position = $3 WHERE id = $1', [p.id, p.parentId, p.position]);
      await audit(tx, req, 'update', 'category', id, { parentId: cat.parentId, position: cat.position }, { parentId: body.parentId, index: body.index, budgets: body.budgets ?? null });
      return { categories: (await loadAll(tx)).filter((c) => c.flow === cat.flow) };
    });
  });

  app.post('/categories/:id/merge', { preHandler: loadCompany }, async (req) => {
    requireRole(req, WRITERS);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const { targetId } = z.object({ targetId: z.string() }).parse(req.body);
    return tenant(req, async (tx) => {
      const all = await loadAll(tx);
      const cat = all.find((c) => c.id === id);
      if (!cat) throw notFound('category.not_found', 'Catégorie introuvable.');
      if (cat.isVat || cat.isSystem) throw badRequest('category.system', 'Cette catégorie est utilisée par Tréso Optimum et ne peut pas être fusionnée.');
      if (targetId === id) throw badRequest('category.merge_self', 'Choisissez une autre catégorie.');
      const used = await usage(tx, [id]);
      await mergeInto(tx, req.company!.id, all, id, targetId);
      await audit(tx, req, 'merge', 'category', id, cat, { targetId, ...used });
      return { merged: used };
    });
  });

  app.delete('/categories/:id', { preHandler: loadCompany }, async (req, reply) => {
    requireRole(req, WRITERS);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const { moveTo } = z.object({ moveTo: z.string().optional() }).parse(req.query);
    await tenant(req, async (tx) => {
      const all = await loadAll(tx);
      const cat = all.find((c) => c.id === id);
      if (!cat) throw notFound('category.not_found', 'Catégorie introuvable.');
      if (cat.isVat || cat.isSystem) throw badRequest('category.system', 'Cette catégorie est utilisée par Tréso Optimum et ne peut pas être supprimée.');
      const children = all.filter((c) => c.parentId === id).length;
      const used = await usage(tx, [id]);
      const hasData = children > 0 || Object.values(used).some((n) => n > 0);
      if (moveTo) {
        await mergeInto(tx, req.company!.id, all, id, moveTo);
      } else if (hasData) {
        const parts = [
          children && `${children} sous-catégorie${children > 1 ? 's' : ''}`,
          used.transactions && `${used.transactions} opération${used.transactions > 1 ? 's' : ''}`,
          used.commitments && `${used.commitments} facture${used.commitments > 1 ? 's' : ''}`,
          used.budgets && `${used.budgets} budget${used.budgets > 1 ? 's' : ''}`,
          used.rules && `${used.rules} règle${used.rules > 1 ? 's' : ''}`,
        ].filter(Boolean);
        throw conflict('category.in_use', `« ${cat.name} » contient ${parts.join(', ')}. Choisissez la catégorie qui les recevra.`);
      } else {
        await tx.query('DELETE FROM budget_notes WHERE category_id = $1', [id]);
        await tx.query("UPDATE transactions SET suggestion = NULL WHERE suggestion->>'categoryId' = $1", [id]);
        await tx.query('DELETE FROM categories WHERE id = $1', [id]);
      }
      await audit(tx, req, 'delete', 'category', id, cat, moveTo ? { moveTo, ...used } : null);
    });
    return reply.status(204).send();
  });

  /** Modèle sectoriel : ajoute les catégories manquantes, sans rien supprimer. */
  app.post('/categories/templates/:key', { preHandler: loadCompany }, async (req) => {
    requireRole(req, WRITERS);
    const { key } = z.object({ key: z.string() }).parse(req.params);
    const template = CATEGORY_TEMPLATES.find((t) => t.key === key);
    if (!template) throw notFound('category.template_not_found', 'Modèle introuvable.');
    return tenant(req, async (tx) => {
      const all = await loadAll(tx);
      const additions = templateAdditions(all, template.categories);
      const norm = (s: string) => s.trim().toLocaleLowerCase('fr').normalize('NFD').replace(/[̀-ͯ]/g, '');
      const created: Category[] = [];
      for (const t of additions) {
        const pool = [...all, ...created];
        const parent = t.parent ? pool.find((c) => c.flow === t.flow && norm(c.name) === norm(t.parent!)) : undefined;
        const parentId = parent?.id ?? null;
        const position = Math.max(0, ...pool.filter((c) => c.flow === t.flow && c.parentId === parentId).map((c) => c.position)) + 1;
        const r = await tx.query<Row>(
          `INSERT INTO categories (company_id, id, name, flow, parent_id, position, kind, vat_rate, is_vat)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
          [req.company!.id, newId(), t.name, t.flow, parentId, position, t.kind ?? 'none', t.vatRate ?? 0, t.isVat ?? false],
        );
        created.push(toCategory(r.rows[0]!));
      }
      await audit(tx, req, 'create', 'category_template', key, null, { added: created.map((c) => c.name) });
      return { added: created };
    });
  });
}
