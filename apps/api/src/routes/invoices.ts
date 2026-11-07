/**
 * Factures clients et fournisseurs (lot 4) : création (avec série), modification
 * « cette échéance / et les suivantes », paiement, rapprochements, doublons,
 * import, relance par email.
 */
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  checkReconciliation,
  daysBetween,
  reminderEmail,
  seriesDates,
  seriesTargets,
  todayInParis,
  addDays,
  type Commitment,
} from '@optimum/treso-engine';
import { audit, loadCompany, requireRole, tenant, WRITERS } from '../context';
import type { Tx } from '../db';
import { badRequest, notFound } from '../errors';
import { refreshPaid, toCommitment, toReconciliation } from '../services/commitments';

type Row = Record<string, unknown>;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date invalide (format AAAA-MM-JJ).');
const terms = z.enum(['on_receipt', 'd15', 'd30', 'd45', 'd60', 'end_of_month', 'custom']);
const vatRate = z.number().refine((v) => [0, 2.1, 5.5, 10, 20].includes(v), 'Taux de TVA inconnu.');
const amount = z.number({ invalid_type_error: 'Indiquez le montant TTC' }).positive('Indiquez le montant TTC').max(1e10);

const fields = {
  counterparty: z.string().trim().min(1, 'Indiquez le tiers.').max(120),
  number: z.string().trim().max(60).nullable(),
  label: z.string().trim().max(200),
  categoryId: z.string().nullable(),
  amountInclTax: amount,
  vatRate,
  vatAmount: z.number().min(0).nullable(),
  issuedAt: isoDate,
  paymentTerms: terms,
  dueAt: isoDate,
  accountId: z.string().nullable(),
  note: z.string().trim().max(2000).nullable(),
  hidden: z.boolean(),
};

const COLUMNS: Record<string, string> = {
  counterparty: 'counterparty',
  number: 'number',
  label: 'label',
  categoryId: 'category_id',
  amountInclTax: 'amount_incl_tax',
  vatRate: 'vat_rate',
  vatAmount: 'vat_amount',
  issuedAt: 'issued_at',
  paymentTerms: 'payment_terms',
  dueAt: 'due_at',
  accountId: 'account_id',
  note: 'note',
  hidden: 'hidden',
};

/** Champs propres à une échéance : jamais recopiés sur les suivantes d'une série. */
const PER_OCCURRENCE = new Set(['number', 'issuedAt', 'dueAt', 'paymentTerms']);

const LOCKED = 'Facture synchronisée depuis votre logiciel de facturation : modifiez-la dans ce logiciel.';

async function loadOne(tx: Tx, id: string): Promise<Commitment> {
  const r = (await tx.query<Row>('SELECT * FROM commitments WHERE id = $1', [id])).rows[0];
  if (!r) throw notFound('commitment.not_found', 'Facture introuvable.');
  return toCommitment(r);
}

async function checkRefs(tx: Tx, flow: string, body: { categoryId?: string | null; accountId?: string | null }) {
  if (body.categoryId) {
    const c = (await tx.query<{ flow: string }>('SELECT flow FROM categories WHERE id = $1', [body.categoryId])).rows[0];
    if (!c) throw notFound('category.not_found', 'Catégorie introuvable.');
    if (c.flow !== flow) throw badRequest('commitment.category_flow', flow === 'in' ? 'Choisissez une catégorie d’encaissement.' : 'Choisissez une catégorie de décaissement.');
  }
  if (body.accountId) {
    const a = await tx.query('SELECT 1 FROM bank_accounts WHERE id = $1', [body.accountId]);
    if (!a.rowCount) throw notFound('bank.account_not_found', 'Compte introuvable.');
  }
}

const newId = () => `inv-${randomUUID().slice(0, 12)}`;

export function registerInvoiceRoutes(app: FastifyInstance) {
  const { mailer } = app.deps;

  // ───────── Création (une facture ou une série) ─────────
  app.post('/commitments', { preHandler: loadCompany }, async (req, reply) => {
    requireRole(req, WRITERS);
    const body = z
      .object({
        flow: z.enum(['in', 'out']),
        ...fields,
        categoryId: z.string({ required_error: 'Choisissez une catégorie.' }).min(1, 'Choisissez une catégorie.'),
        number: fields.number.optional(),
        label: fields.label.optional(),
        vatAmount: fields.vatAmount.optional(),
        accountId: fields.accountId.optional(),
        note: fields.note.optional(),
        hidden: fields.hidden.optional(),
        repeat: z
          .object({
            intervalMonths: z.number().int().min(1).max(24),
            count: z.number().int().min(1, 'Entre 1 et 120 échéances.').max(120, 'Entre 1 et 120 échéances.').nullable().optional(),
            endDate: isoDate.nullable().optional(),
          })
          .refine((r) => r.count || r.endDate, 'Indiquez un nombre d’échéances ou une date de fin.')
          .nullable()
          .optional(),
      })
      .parse(req.body);
    const created = await tenant(req, async (tx) => {
      await checkRefs(tx, body.flow, body);
      const dates = body.repeat ? seriesDates(body.dueAt, body.repeat.intervalMonths, { count: body.repeat.count, endDate: body.repeat.endDate }) : [body.dueAt];
      const seriesId = body.repeat && dates.length > 1 ? `ser-${randomUUID().slice(0, 12)}` : null;
      const gap = daysBetween(body.issuedAt, body.dueAt);
      const out: Commitment[] = [];
      for (const [i, dueAt] of dates.entries()) {
        const r = await tx.query<Row>(
          `INSERT INTO commitments (company_id, id, flow, counterparty, number, label, amount_incl_tax, vat_rate, vat_amount, issued_at, due_at,
             payment_terms, category_id, account_id, note, hidden, series_id, series_index, source, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, 'manual', $19) RETURNING *`,
          [
            req.company!.id, newId(), body.flow, body.counterparty, i === 0 ? (body.number ?? null) : null,
            body.label || (body.number ? `Facture ${body.number}` : body.counterparty), body.amountInclTax, body.vatRate, body.vatAmount ?? null,
            i === 0 ? body.issuedAt : addDays(dueAt, -gap), dueAt, body.paymentTerms, body.categoryId, body.accountId ?? null, body.note ?? null,
            body.hidden ?? false, seriesId, seriesId ? i + 1 : null, req.userId,
          ],
        );
        out.push(toCommitment(r.rows[0]!));
      }
      await audit(tx, req, 'create', 'commitment', out[0]!.id, null, { ...body, occurrences: out.length });
      return out;
    });
    return reply.status(201).send({ commitments: created });
  });

  // ───────── Modification (et statut, utilisé par « Annuler ») ─────────
  app.patch('/commitments/:id', { preHandler: loadCompany }, async (req) => {
    requireRole(req, WRITERS);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const body = z
      .object({
        ...fields,
        status: z.enum(['pending', 'paid', 'cancelled']),
        amountPaid: z.number().min(0),
        paidAt: isoDate.nullable(),
        scope: z.enum(['one', 'following']),
      })
      .partial()
      .strict()
      .parse(req.body);
    const { scope = 'one', ...changes } = body;
    if (Object.keys(changes).length === 0) throw badRequest('validation.empty', 'Aucune modification.');
    return tenant(req, async (tx) => {
      const target = await loadOne(tx, id);
      if (target.source === 'integration' && ('amountInclTax' in changes || 'vatRate' in changes)) throw badRequest('commitment.locked', LOCKED);
      await checkRefs(tx, target.flow, changes);
      const today = todayInParis();
      const all = target.seriesId ? (await tx.query<Row>('SELECT * FROM commitments WHERE series_id = $1', [target.seriesId])).rows.map(toCommitment) : [target];
      const targets = seriesTargets(all, target, scope, today);
      const shift = changes.dueAt ? daysBetween(target.dueAt, changes.dueAt) : 0;
      for (const c of targets) {
        const own = c.id === target.id;
        const sets: string[] = [];
        const values: unknown[] = [c.id];
        const put = (col: string, v: unknown) => {
          values.push(v);
          sets.push(`${col} = $${values.length}`);
        };
        for (const [k, v] of Object.entries(changes)) {
          if (k === 'status') put('status', v);
          else if (k === 'amountPaid') put('amount_paid', v);
          else if (k === 'paidAt') put('paid_at', v);
          else if (own || !PER_OCCURRENCE.has(k)) put(COLUMNS[k]!, v);
        }
        // Une nouvelle échéance décale aussi les suivantes du même nombre de jours
        if (!own && shift) {
          put('due_at', addDays(c.dueAt, shift));
          put('issued_at', addDays(c.issuedAt, shift));
        }
        if (changes.status === 'paid' && own && !('amountPaid' in changes)) {
          put('amount_paid', c.amountInclTax);
          if (!('paidAt' in changes)) put('paid_at', today);
        }
        if (sets.length) await tx.query(`UPDATE commitments SET ${sets.join(', ')} WHERE id = $1`, values);
      }
      const after = (await tx.query<Row>('SELECT * FROM commitments WHERE id = ANY($1)', [targets.map((c) => c.id)])).rows.map(toCommitment);
      await audit(tx, req, 'update', 'commitment', id, { scope, count: targets.length }, changes);
      return { commitments: after };
    });
  });

  // ───────── Suppression (cette échéance / et les suivantes) ─────────
  app.delete('/commitments/:id', { preHandler: loadCompany }, async (req) => {
    requireRole(req, WRITERS);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const { scope } = z.object({ scope: z.enum(['one', 'following']).default('one') }).parse(req.query);
    return tenant(req, async (tx) => {
      const target = await loadOne(tx, id);
      if (target.source === 'integration') throw badRequest('commitment.locked', LOCKED);
      const all = target.seriesId ? (await tx.query<Row>('SELECT * FROM commitments WHERE series_id = $1', [target.seriesId])).rows.map(toCommitment) : [target];
      const ids = seriesTargets(all, target, scope, todayInParis()).map((c) => c.id);
      await tx.query('UPDATE commitments SET replaced_by = NULL WHERE replaced_by = ANY($1)', [ids]);
      await tx.query('DELETE FROM commitments WHERE id = ANY($1)', [ids]);
      await audit(tx, req, 'delete', 'commitment', id, { number: target.number, scope }, { deleted: ids.length });
      return { deleted: ids };
    });
  });

  app.post('/commitments/:id/duplicate', { preHandler: loadCompany }, async (req, reply) => {
    requireRole(req, WRITERS);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const copy = await tenant(req, async (tx) => {
      const c = await loadOne(tx, id);
      const r = await tx.query<Row>(
        `INSERT INTO commitments (company_id, id, flow, counterparty, number, label, amount_incl_tax, vat_rate, vat_amount, issued_at, due_at,
           payment_terms, category_id, account_id, note, hidden, source, created_by)
         SELECT company_id, $2, flow, counterparty, NULL, label, amount_incl_tax, vat_rate, vat_amount, issued_at, due_at,
           payment_terms, category_id, account_id, note, hidden, 'manual', $3 FROM commitments WHERE id = $1 RETURNING *`,
        [c.id, newId(), req.userId],
      );
      await audit(tx, req, 'create', 'commitment', r.rows[0]!.id as string, null, { duplicateOf: id });
      return toCommitment(r.rows[0]!);
    });
    return reply.status(201).send(copy);
  });

  // ───────── Doublons possibles ─────────
  app.post('/commitments/duplicates/resolve', { preHandler: loadCompany }, async (req) => {
    requireRole(req, WRITERS);
    const body = z.object({ manualId: z.string(), importedId: z.string(), action: z.enum(['replace', 'keep']) }).parse(req.body);
    return tenant(req, async (tx) => {
      const manual = await loadOne(tx, body.manualId);
      const imported = await loadOne(tx, body.importedId);
      if (body.action === 'replace') {
        // L'échéance manuelle sort de la trésorerie ; la catégorie et le compte passent à la facture importée si elle n'en a pas
        await tx.query('UPDATE commitments SET replaced_by = $2 WHERE id = $1', [manual.id, imported.id]);
        await tx.query('UPDATE commitments SET category_id = coalesce(category_id, $2), account_id = coalesce(account_id, $3) WHERE id = $1', [
          imported.id, manual.categoryId, manual.accountId ?? null,
        ]);
      } else {
        await tx.query('UPDATE commitments SET not_duplicate_of = $2 WHERE id = $1', [manual.id, imported.id]);
      }
      await audit(tx, req, 'update', 'commitment_duplicate', manual.id, null, body);
      const rows = (await tx.query<Row>('SELECT * FROM commitments WHERE id = ANY($1)', [[manual.id, imported.id]])).rows.map(toCommitment);
      return { commitments: rows };
    });
  });

  // ───────── Rapprochements (5.11) ─────────
  app.post('/reconciliations', { preHandler: loadCompany }, async (req, reply) => {
    requireRole(req, WRITERS);
    const body = z.object({ transactionId: z.string(), commitmentId: z.string(), amount: z.number().positive().optional() }).parse(req.body);
    const result = await tenant(req, async (tx) => {
      const t = (await tx.query<Row>('SELECT * FROM transactions WHERE id = $1', [body.transactionId])).rows[0];
      if (!t) throw notFound('reconciliation.not_found', 'Opération introuvable.');
      const c = await loadOne(tx, body.commitmentId);
      if (t.is_split) throw badRequest('reconciliation.split', 'Rapprochez l’une des lignes de cette opération divisée.');
      const existing = (await tx.query<Row>('SELECT * FROM reconciliations WHERE transaction_id = $1', [t.id])).rows.map(toReconciliation);
      if (existing.some((r) => r.commitmentId === c.id)) throw badRequest('reconciliation.exists', 'Ce paiement est déjà rapproché de cette facture.');
      const tAmount = Number(t.amount);
      const allocated = existing.reduce((s, r) => s + r.amount, 0);
      const rest = Math.max(0, c.amountInclTax - (c.amountPaid ?? 0));
      const value = Math.round((body.amount ?? Math.min(Math.abs(tAmount) - allocated, rest)) * 100) / 100;
      const error = checkReconciliation({ id: t.id as string, amount: tAmount }, c, value, existing);
      if (error) throw badRequest('reconciliation.invalid', error);
      const recId = `rec-${randomUUID().slice(0, 12)}`;
      await tx.query('INSERT INTO reconciliations (company_id, id, transaction_id, commitment_id, amount, created_by) VALUES ($1, $2, $3, $4, $5, $6)', [
        req.company!.id, recId, t.id, c.id, value, req.userId,
      ]);
      // L'opération prend la catégorie de la facture si elle n'en a pas
      await tx.query('UPDATE transactions SET category_id = coalesce(category_id, $2), suggestion = NULL WHERE id = $1', [t.id, c.categoryId]);
      const commitment = await refreshPaid(tx, c.id);
      await audit(tx, req, 'create', 'reconciliation', recId, null, { transactionId: t.id, commitmentId: c.id, amount: value });
      const tr = (await tx.query<Row>('SELECT category_id FROM transactions WHERE id = $1', [t.id])).rows[0]!;
      return { reconciliation: { id: recId, transactionId: t.id as string, commitmentId: c.id, amount: value }, commitment, transactionCategoryId: tr.category_id };
    });
    return reply.status(201).send(result);
  });

  app.delete('/reconciliations/:id', { preHandler: loadCompany }, async (req) => {
    requireRole(req, WRITERS);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    return tenant(req, async (tx) => {
      const r = (await tx.query<Row>('DELETE FROM reconciliations WHERE id = $1 RETURNING *', [id])).rows[0];
      if (!r) throw notFound('reconciliation.not_found', 'Rapprochement introuvable.');
      const commitment = await refreshPaid(tx, r.commitment_id as string);
      await audit(tx, req, 'delete', 'reconciliation', id, toReconciliation(r), null);
      return { commitment };
    });
  });

  // ───────── Import de factures ─────────
  app.post('/commitments/import', { preHandler: loadCompany }, async (req, reply) => {
    requireRole(req, WRITERS);
    const body = z
      .object({
        flow: z.enum(['in', 'out']),
        accountId: z.string().nullable().optional(),
        fileName: z.string().trim().min(1).max(200),
        mapping: z.record(z.string()).optional(),
        rows: z
          .array(
            z.object({
              counterparty: fields.counterparty,
              number: z.string().max(60).nullable(),
              label: z.string().max(200),
              amountInclTax: amount,
              vatRate: vatRate.nullable(),
              issuedAt: isoDate,
              dueAt: isoDate,
              categoryId: z.string().nullable(),
              note: z.string().max(2000).nullable(),
            }),
          )
          .min(1, 'Aucune ligne à importer.')
          .max(5000),
      })
      .parse(req.body);
    const result = await tenant(req, async (tx) => {
      await checkRefs(tx, body.flow, { accountId: body.accountId });
      const cats = new Map(
        (await tx.query<{ id: string; flow: string; vat_rate: number }>('SELECT id, flow, vat_rate FROM categories')).rows.map((c) => [c.id, c]),
      );
      const importId = `imp-${randomUUID().slice(0, 8)}`;
      await tx.query('INSERT INTO imports (company_id, id, type, file_name, rows_count, mapping, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7)', [
        req.company!.id, importId, 'commitments', body.fileName, body.rows.length, body.mapping ? JSON.stringify(body.mapping) : null, req.userId,
      ]);
      for (const r of body.rows) {
        const cat = r.categoryId ? cats.get(r.categoryId) : undefined;
        const categoryId = cat && cat.flow === body.flow ? cat.id : null;
        await tx.query(
          `INSERT INTO commitments (company_id, id, flow, counterparty, number, label, amount_incl_tax, vat_rate, issued_at, due_at,
             payment_terms, category_id, account_id, note, source, import_id, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'custom', $11, $12, $13, 'import', $14, $15)`,
          [
            req.company!.id, newId(), body.flow, r.counterparty, r.number, r.label || r.counterparty, r.amountInclTax, r.vatRate ?? Number(cat?.vat_rate ?? 0),
            r.issuedAt, r.dueAt, categoryId, body.accountId ?? null, r.note, importId, req.userId,
          ],
        );
      }
      if (body.mapping) {
        await tx.query(
          `INSERT INTO import_mappings (company_id, type, mapping) VALUES ($1, 'commitments', $2)
           ON CONFLICT (company_id, type) DO UPDATE SET mapping = excluded.mapping, updated_at = now()`,
          [req.company!.id, JSON.stringify(body.mapping)],
        );
      }
      await audit(tx, req, 'import', 'commitments', importId, null, { fileName: body.fileName, rows: body.rows.length });
      return { importId, imported: body.rows.length };
    });
    return reply.status(201).send(result);
  });

  // ───────── Relance d'un client ─────────
  app.get('/commitments/:id/reminder', { preHandler: loadCompany }, async (req) => {
    requireRole(req, WRITERS);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    return tenant(req, async (tx) => {
      const c = await loadOne(tx, id);
      const company = (await tx.query<{ name: string }>('SELECT name FROM companies WHERE id = $1', [req.company!.id])).rows[0]!;
      return reminderEmail(c, company.name, todayInParis());
    });
  });

  app.post('/commitments/:id/reminder', { preHandler: loadCompany }, async (req) => {
    requireRole(req, WRITERS);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const body = z
      .object({
        to: z.string().trim().email('Adresse email invalide.'),
        subject: z.string().trim().min(1, 'Indiquez un objet.').max(200),
        body: z.string().trim().min(1, 'Le message est vide.').max(5000),
      })
      .parse(req.body);
    const info = await tenant(req, async (tx) => {
      const c = await loadOne(tx, id);
      if (c.flow !== 'in') throw badRequest('reminder.flow', 'Seules les factures clients peuvent être relancées.');
      const me = (await tx.query<{ email: string }>('SELECT email FROM users WHERE id = $1', [req.userId])).rows[0]!;
      await audit(tx, req, 'create', 'reminder', id, null, { to: body.to, subject: body.subject });
      return { replyTo: me.email };
    });
    await mailer.send({ to: body.to, subject: body.subject, text: body.body, replyTo: info.replyTo, plain: true });
    return { sent: true, message: `Relance envoyée à ${body.to}.` };
  });

  // ───────── Compte par défaut d'une catégorie (5.12) ─────────
  app.patch('/categories/:id', { preHandler: loadCompany }, async (req) => {
    requireRole(req, WRITERS);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const body = z.object({ defaultAccountId: z.string().nullable() }).strict().parse(req.body);
    return tenant(req, async (tx) => {
      if (body.defaultAccountId) await checkRefs(tx, 'in', { accountId: body.defaultAccountId });
      const r = await tx.query('UPDATE categories SET default_account_id = $2 WHERE id = $1', [id, body.defaultAccountId]);
      if (!r.rowCount) throw notFound('category.not_found', 'Catégorie introuvable.');
      await audit(tx, req, 'update', 'category', id, null, body);
      return { id, defaultAccountId: body.defaultAccountId };
    });
  });
}
