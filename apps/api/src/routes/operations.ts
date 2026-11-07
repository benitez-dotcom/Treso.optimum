/**
 * Opérations bancaires (écran 7.6) : saisie, modification, division, suppression,
 * import de fichiers, règles de catégorisation.
 */
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { normalizeLabel, ruleMatches, validateSplit } from '@optimum/treso-engine';
import { audit, loadCompany, requireRole, tenant, WRITERS } from '../context';
import { badRequest, notFound } from '../errors';
import { ingestTransactions, refreshManualBalances, toRule, toTransaction } from '../services/operations';

type Row = Record<string, unknown>;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date invalide (format AAAA-MM-JJ).');
const money = z.number().finite().min(-1e10).max(1e10).transform((n) => Math.round(n * 100) / 100);

const ruleCondition = z.union([
  z.object({ field: z.literal('label'), op: z.enum(['contains', 'startsWith']), value: z.string().trim().min(1).max(120) }),
  z.object({ field: z.literal('amount'), op: z.literal('between'), min: z.number(), max: z.number() }),
  z.object({ field: z.literal('account'), op: z.literal('is'), value: z.string() }),
]);

export function registerOperationRoutes(app: FastifyInstance) {
  /** Nouvelle opération saisie à la main (comptes manuels uniquement). */
  app.post('/transactions', { preHandler: loadCompany }, async (req, reply) => {
    requireRole(req, WRITERS);
    const body = z
      .object({
        accountId: z.string(),
        bookedAt: isoDate,
        label: z.string().trim().min(1, 'Indiquez un libellé.').max(200),
        amount: money.refine((n) => n !== 0, 'Le montant ne peut pas être nul.'),
        categoryId: z.string().nullable().optional(),
        note: z.string().max(500).optional(),
      })
      .parse(req.body);
    return tenant(req, async (tx) => {
      const acc = (await tx.query<Row>('SELECT is_manual FROM bank_accounts WHERE id = $1', [body.accountId])).rows[0];
      if (!acc) throw notFound('bank.account_not_found', 'Compte introuvable.');
      if (!acc.is_manual) throw badRequest('transaction.account_synced', 'Ce compte est synchronisé avec votre banque : ses opérations arrivent automatiquement.');
      const [id] = await ingestTransactions(tx, req.company!.id, req.userId!, [
        { accountId: body.accountId, bookedAt: body.bookedAt, rawLabel: body.label, amount: body.amount, source: 'manual', categoryId: body.categoryId ?? null, note: body.note ?? null },
      ]);
      await refreshManualBalances(tx);
      await audit(tx, req, 'create', 'transaction', id!, null, body);
      const t = (await tx.query<Row>('SELECT * FROM transactions WHERE id = $1', [id])).rows[0]!;
      reply.status(201);
      return toTransaction(t);
    });
  });

  /** Modification d'une opération : catégorie, exclusion, note, date d'imputation. */
  app.patch('/transactions/:id', { preHandler: loadCompany }, async (req) => {
    requireRole(req, WRITERS);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const body = z
      .object({
        categoryId: z.string().nullable(),
        hidden: z.boolean(),
        note: z.string().max(500).nullable(),
        bookedAt: isoDate,
        resetBookedAt: z.literal(true),
      })
      .partial()
      .strict()
      .parse(req.body);
    return tenant(req, async (tx) => {
      const before = (await tx.query<Row>('SELECT * FROM transactions WHERE id = $1', [id])).rows[0];
      if (!before) throw notFound('transaction.not_found', 'Opération introuvable.');
      if (before.is_split && body.categoryId !== undefined) {
        throw badRequest('transaction.split', 'Cette opération est divisée : catégorisez chacune de ses lignes.');
      }
      let bookedAt = before.booked_at as string;
      let original = before.original_booked_at as string | null;
      if (body.resetBookedAt && original) {
        bookedAt = original;
        original = null;
      } else if (body.bookedAt && body.bookedAt !== bookedAt) {
        original ??= bookedAt;
        bookedAt = body.bookedAt;
        if (bookedAt === original) original = null;
      }
      await tx.query(
        `UPDATE transactions SET
           category_id = CASE WHEN $2 THEN $3 ELSE category_id END,
           hidden = coalesce($4, hidden),
           hidden_reason = CASE WHEN $4 IS NULL THEN hidden_reason WHEN $4 THEN 'manual' ELSE NULL END,
           note = CASE WHEN $5 THEN $6 ELSE note END,
           booked_at = $7, original_booked_at = $8,
           suggestion = CASE WHEN $2 OR $4 IS NOT NULL THEN NULL ELSE suggestion END
         WHERE id = $1`,
        [id, 'categoryId' in body, body.categoryId ?? null, body.hidden ?? null, 'note' in body, body.note || null, bookedAt, original],
      );
      // Les lignes d'une division suivent la date de l'opération
      if (before.is_split) await tx.query('UPDATE transactions SET booked_at = $2, original_booked_at = $3 WHERE parent_id = $1', [id, bookedAt, original]);
      await refreshManualBalances(tx);
      await audit(tx, req, 'update', 'transaction', id, toTransaction(before), body);
      return toTransaction((await tx.query<Row>('SELECT * FROM transactions WHERE id = $1', [id])).rows[0]!);
    });
  });

  /** Mise à jour en lot (catégoriser, valider des suggestions, exclure / réintégrer). */
  app.post('/transactions/batch', { preHandler: loadCompany }, async (req) => {
    requireRole(req, WRITERS);
    const { ops } = z
      .object({
        ops: z
          .array(
            z.object({
              id: z.string(),
              categoryId: z.string().nullable().optional(),
              acceptSuggestion: z.literal(true).optional(),
              hidden: z.boolean().optional(),
              note: z.string().max(500).optional(),
            }),
          )
          .min(1)
          .max(1000),
      })
      .parse(req.body);
    return tenant(req, async (tx) => {
      let updated = 0;
      for (const op of ops) {
        const r = await tx.query(
          `UPDATE transactions SET
             category_id = CASE WHEN $6 AND suggestion IS NOT NULL THEN suggestion->>'categoryId' WHEN $3 THEN $2 ELSE category_id END,
             hidden = coalesce($4, hidden),
             hidden_reason = CASE WHEN $4 IS NULL THEN hidden_reason WHEN $4 THEN 'manual' ELSE NULL END,
             note = coalesce($5, note),
             suggestion = CASE WHEN $3 OR $6 OR $4 IS NOT NULL THEN NULL ELSE suggestion END
           WHERE id = $1 AND (NOT is_split OR NOT ($3 OR $6))`,
          [op.id, op.categoryId ?? null, 'categoryId' in op, op.hidden ?? null, op.note ?? null, op.acceptSuggestion === true],
        );
        updated += r.rowCount ?? 0;
      }
      await audit(tx, req, 'update', 'transactions', null, null, { count: ops.length, sample: ops.slice(0, 5) });
      return { updated };
    });
  });

  /** Suppression en lot : opérations saisies ou importées uniquement. */
  app.post('/transactions/delete', { preHandler: loadCompany }, async (req) => {
    requireRole(req, WRITERS);
    const { ids } = z.object({ ids: z.array(z.string()).min(1).max(1000) }).parse(req.body);
    return tenant(req, async (tx) => {
      const rows = (await tx.query<Row>('SELECT id, source FROM transactions WHERE id = ANY($1)', [ids])).rows;
      const blocked = rows.filter((r) => r.source === 'bank' || r.source === 'split');
      if (blocked.length) {
        throw badRequest(
          'transaction.delete_bank',
          blocked.length === 1
            ? 'Une opération vient de votre banque : elle ne peut pas être supprimée. Excluez-la des totaux si besoin.'
            : `${blocked.length} opérations viennent de votre banque : elles ne peuvent pas être supprimées. Excluez-les des totaux si besoin.`,
        );
      }
      const r = await tx.query('DELETE FROM transactions WHERE id = ANY($1)', [ids]);
      await refreshManualBalances(tx);
      await audit(tx, req, 'delete', 'transactions', null, { ids }, null);
      return { deleted: r.rowCount ?? 0 };
    });
  });

  /** Division d'une opération en lignes (catégorie + montant), reste à répartir nul. */
  app.post('/transactions/:id/split', { preHandler: loadCompany }, async (req) => {
    requireRole(req, WRITERS);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const { lines } = z
      .object({ lines: z.array(z.object({ amount: money, categoryId: z.string().nullable(), note: z.string().max(200).optional() })).min(2).max(50) })
      .parse(req.body);
    return tenant(req, async (tx) => {
      const p = (await tx.query<Row>('SELECT * FROM transactions WHERE id = $1', [id])).rows[0];
      if (!p) throw notFound('transaction.not_found', 'Opération introuvable.');
      if (p.parent_id) throw badRequest('transaction.split_line', 'Cette ligne fait déjà partie d’une division.');
      const error = validateSplit(p.amount as number, lines.map((l) => l.amount));
      if (error) throw badRequest('transaction.split_invalid', error);
      await tx.query('DELETE FROM transactions WHERE parent_id = $1', [id]);
      let i = 0;
      for (const l of lines) {
        i++;
        await tx.query(
          `INSERT INTO transactions (company_id, id, account_id, booked_at, original_booked_at, raw_label, label, counterparty, amount,
             category_id, hidden, note, parent_id, source, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'split', $14)`,
          [
            req.company!.id, `${id}~${i}`, p.account_id, p.booked_at, p.original_booked_at, p.raw_label, p.label, p.counterparty, l.amount,
            l.categoryId, p.hidden, l.note ?? null, id, req.userId,
          ],
        );
      }
      await tx.query('UPDATE transactions SET is_split = true, category_id = NULL, suggestion = NULL WHERE id = $1', [id]);
      await audit(tx, req, 'split', 'transaction', id, toTransaction(p), { lines });
      const all = (await tx.query<Row>('SELECT * FROM transactions WHERE id = $1 OR parent_id = $1 ORDER BY id', [id])).rows.map(toTransaction);
      return { transactions: all };
    });
  });

  app.delete('/transactions/:id/split', { preHandler: loadCompany }, async (req) => {
    requireRole(req, WRITERS);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    return tenant(req, async (tx) => {
      const p = (await tx.query<Row>('SELECT * FROM transactions WHERE id = $1', [id])).rows[0];
      if (!p) throw notFound('transaction.not_found', 'Opération introuvable.');
      if (!p.is_split) throw badRequest('transaction.not_split', 'Cette opération n’est pas divisée.');
      // L'opération reprend la catégorie de sa plus grande ligne
      const main = (await tx.query<Row>('SELECT category_id FROM transactions WHERE parent_id = $1 ORDER BY abs(amount) DESC LIMIT 1', [id])).rows[0];
      await tx.query('DELETE FROM transactions WHERE parent_id = $1', [id]);
      await tx.query('UPDATE transactions SET is_split = false, category_id = $2 WHERE id = $1', [id, main?.category_id ?? null]);
      await audit(tx, req, 'unsplit', 'transaction', id, null, null);
      return toTransaction((await tx.query<Row>('SELECT * FROM transactions WHERE id = $1', [id])).rows[0]!);
    });
  });

  // ───────── Import de fichiers ─────────

  /**
   * Import d'opérations déjà lues et vérifiées par le navigateur (assistant en 3 étapes).
   * Le serveur revalide chaque ligne, rattache les catégories par leur nom et
   * mémorise la correspondance des colonnes pour le prochain import.
   */
  app.post('/transactions/import', { preHandler: loadCompany }, async (req, reply) => {
    requireRole(req, WRITERS);
    const body = z
      .object({
        fileName: z.string().trim().min(1).max(200),
        accountId: z.string(),
        mapping: z.record(z.string(), z.string()).optional(),
        rows: z
          .array(
            z.object({
              bookedAt: isoDate,
              rawLabel: z.string().trim().min(1).max(300),
              amount: money.refine((n) => n !== 0),
              categoryName: z.string().max(120).nullable().optional(),
              note: z.string().max(500).nullable().optional(),
            }),
          )
          .min(1, 'Le fichier ne contient aucune opération à importer.')
          .max(20_000),
      })
      .parse(req.body);
    return tenant(req, async (tx) => {
      const acc = (await tx.query<Row>('SELECT id FROM bank_accounts WHERE id = $1', [body.accountId])).rows[0];
      if (!acc) throw notFound('bank.account_not_found', 'Compte introuvable.');
      const cats = (await tx.query<{ id: string; name: string; flow: string }>('SELECT id, name, flow FROM categories')).rows;
      const byName = new Map(cats.map((c) => [`${c.flow}|${normalizeLabel(c.name)}`, c.id]));
      const importId = `imp-${randomUUID().slice(0, 8)}`;
      await tx.query('INSERT INTO imports (company_id, id, type, file_name, rows_count, mapping, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7)', [
        req.company!.id, importId, 'transactions', body.fileName, body.rows.length, body.mapping ? JSON.stringify(body.mapping) : null, req.userId,
      ]);
      const created = await ingestTransactions(
        tx,
        req.company!.id,
        req.userId!,
        body.rows.map((r) => ({
          accountId: body.accountId,
          bookedAt: r.bookedAt,
          rawLabel: r.rawLabel,
          amount: r.amount,
          source: 'import' as const,
          importId,
          note: r.note ?? null,
          categoryId: r.categoryName ? (byName.get(`${r.amount > 0 ? 'in' : 'out'}|${normalizeLabel(r.categoryName)}`) ?? null) : null,
        })),
      );
      await tx.query('UPDATE imports SET rows_count = $2 WHERE id = $1', [importId, created.length]);
      if (body.mapping) {
        await tx.query(
          `INSERT INTO import_mappings (company_id, type, mapping) VALUES ($1, 'transactions', $2)
           ON CONFLICT (company_id, type) DO UPDATE SET mapping = excluded.mapping, updated_at = now()`,
          [req.company!.id, JSON.stringify(body.mapping)],
        );
      }
      await refreshManualBalances(tx);
      await audit(tx, req, 'import', 'transactions', importId, null, { fileName: body.fileName, rows: created.length });
      reply.status(201);
      return { importId, imported: created.length };
    });
  });

  app.get('/import-mappings/:type', { preHandler: loadCompany }, async (req) => {
    const { type } = z.object({ type: z.enum(['transactions', 'commitments', 'budgets']) }).parse(req.params);
    return tenant(req, async (tx) => {
      const r = (await tx.query<{ mapping: unknown }>('SELECT mapping FROM import_mappings WHERE type = $1', [type])).rows[0];
      return { mapping: r?.mapping ?? null };
    });
  });

  app.get('/imports', { preHandler: loadCompany }, async (req) =>
    tenant(req, async (tx) =>
      (
        await tx.query<Row>(
          `SELECT i.id, i.type, i.file_name, i.rows_count, i.created_at, u.first_name, u.last_name
           FROM imports i LEFT JOIN users u ON u.id = i.created_by ORDER BY i.created_at DESC LIMIT 200`,
        )
      ).rows.map((r) => ({
        id: r.id,
        type: r.type,
        fileName: r.file_name,
        rowsCount: r.rows_count,
        createdAt: r.created_at,
        author: [r.first_name, r.last_name].filter(Boolean).join(' ') || null,
      })),
    ),
  );

  /** Annule un import : supprime tout ce qu'il a créé. */
  app.delete('/imports/:id', { preHandler: loadCompany }, async (req, reply) => {
    requireRole(req, WRITERS);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    await tenant(req, async (tx) => {
      const imp = (await tx.query<Row>('SELECT * FROM imports WHERE id = $1', [id])).rows[0];
      if (!imp) throw notFound('import.not_found', 'Import introuvable.');
      await tx.query('DELETE FROM imports WHERE id = $1', [id]);
      await refreshManualBalances(tx);
      await audit(tx, req, 'delete', 'import', id, { fileName: imp.file_name, rows: imp.rows_count }, null);
    });
    return reply.status(204).send();
  });

  // ───────── Règles ─────────

  const ruleBody = z.object({
    conditions: z.array(ruleCondition).min(1, 'Ajoutez au moins une condition.').max(5),
    categoryId: z.string(),
    autoApply: z.boolean().default(false),
    priority: z.number().int().min(0).max(1000).default(5),
  });

  app.post('/rules', { preHandler: loadCompany }, async (req, reply) => {
    requireRole(req, WRITERS);
    const body = ruleBody.parse(req.body);
    const id = `r-${randomUUID().slice(0, 8)}`;
    await tenant(req, async (tx) => {
      const cat = (await tx.query('SELECT 1 FROM categories WHERE id = $1', [body.categoryId])).rowCount;
      if (!cat) throw notFound('category.not_found', 'Catégorie introuvable.');
      await tx.query('INSERT INTO rules (company_id, id, conditions, category_id, auto_apply, priority) VALUES ($1, $2, $3, $4, $5, $6)', [
        req.company!.id, id, JSON.stringify(body.conditions), body.categoryId, body.autoApply, body.priority,
      ]);
      await audit(tx, req, 'create', 'rule', id, null, body);
    });
    return reply.status(201).send({ id, ...body });
  });

  app.patch('/rules/:id', { preHandler: loadCompany }, async (req) => {
    requireRole(req, WRITERS);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const body = ruleBody.partial().strict().parse(req.body);
    return tenant(req, async (tx) => {
      const before = (await tx.query<Row>('SELECT * FROM rules WHERE id = $1', [id])).rows[0];
      if (!before) throw notFound('rule.not_found', 'Règle introuvable.');
      await tx.query(
        `UPDATE rules SET conditions = coalesce($2, conditions), category_id = coalesce($3, category_id),
           auto_apply = coalesce($4, auto_apply), priority = coalesce($5, priority) WHERE id = $1`,
        [id, body.conditions ? JSON.stringify(body.conditions) : null, body.categoryId ?? null, body.autoApply ?? null, body.priority ?? null],
      );
      await audit(tx, req, 'update', 'rule', id, toRule(before), body);
      return toRule((await tx.query<Row>('SELECT * FROM rules WHERE id = $1', [id])).rows[0]!);
    });
  });

  app.delete('/rules/:id', { preHandler: loadCompany }, async (req, reply) => {
    requireRole(req, WRITERS);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    await tenant(req, async (tx) => {
      const before = (await tx.query<Row>('SELECT * FROM rules WHERE id = $1', [id])).rows[0];
      if (!before) throw notFound('rule.not_found', 'Règle introuvable.');
      await tx.query('DELETE FROM rules WHERE id = $1', [id]);
      await audit(tx, req, 'delete', 'rule', id, toRule(before), null);
    });
    return reply.status(204).send();
  });

  /** Ordre de priorité (glisser-déposer) : la première règle de la liste est la plus prioritaire. */
  app.put('/rules/order', { preHandler: loadCompany }, async (req) => {
    requireRole(req, WRITERS);
    const { ids } = z.object({ ids: z.array(z.string()).min(1).max(500) }).parse(req.body);
    return tenant(req, async (tx) => {
      for (let i = 0; i < ids.length; i++) await tx.query('UPDATE rules SET priority = $2 WHERE id = $1', [ids[i], ids.length - i]);
      await audit(tx, req, 'update', 'rules_order', null, null, { ids });
      return { ok: true };
    });
  });

  /** Applique une règle aux opérations existantes non catégorisées (ou à toutes, si demandé). */
  app.post('/rules/:id/apply', { preHandler: loadCompany }, async (req) => {
    requireRole(req, WRITERS);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const { overwrite } = z.object({ overwrite: z.boolean().default(false) }).parse(req.body ?? {});
    return tenant(req, async (tx) => {
      const rule = (await tx.query<Row>('SELECT * FROM rules WHERE id = $1', [id])).rows[0];
      if (!rule) throw notFound('rule.not_found', 'Règle introuvable.');
      const r = toRule(rule);
      const flow = (await tx.query<{ flow: string }>('SELECT flow FROM categories WHERE id = $1', [r.categoryId])).rows[0]?.flow;
      const candidates = (
        await tx.query<Row>(`SELECT * FROM transactions WHERE NOT is_split AND NOT hidden ${overwrite ? '' : 'AND category_id IS NULL'}`)
      ).rows
        .map(toTransaction)
        .filter((t) => ruleMatches(r, t) && (flow === 'in' ? t.amount > 0 : t.amount < 0));
      const ids = candidates.map((t) => t.id);
      if (ids.length) await tx.query('UPDATE transactions SET category_id = $2, suggestion = NULL WHERE id = ANY($1)', [ids, r.categoryId]);
      await audit(tx, req, 'apply', 'rule', id, null, { count: ids.length });
      return { updated: ids.length, ids };
    });
  });
}
