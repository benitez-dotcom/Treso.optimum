/**
 * Pré-comptabilité (écran 7.16) : réglages, plan de comptes, correspondances,
 * génération des écritures, vérification, validation (équilibre obligatoire),
 * refus, envoi, export FEC.
 */
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  buildFec,
  checkEntry,
  DEFAULT_CHART,
  DEFAULT_VAT_ACCOUNTS,
  defaultJournals,
  invoiceEntry,
  linksOf,
  pendingSources,
  transactionEntry,
  type Entry,
  type EntryLine,
  type Journals,
  type LedgerAccount,
  type PrecomptaContext,
  type VatAccounts,
} from '@optimum/treso-engine';
import { audit, loadCompany, requireRole, tenant, WRITERS } from '../context';
import type { Tx } from '../db';
import { badRequest, notFound } from '../errors';
import { toCategory } from './data';
import { toCommitment, toReconciliation } from '../services/commitments';
import { toTransaction } from '../services/operations';

type Row = Record<string, unknown>;
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date invalide (AAAA-MM-JJ).');
const account = z.string().regex(/^\d{3,}[A-Z0-9]*$/, 'Numéro de compte invalide (chiffres, par exemple 606400).');

interface Settings {
  provider: 'none' | 'demo' | 'other';
  software: string | null;
  dossierCode: string | null;
  vat: VatAccounts;
  journals: Journals;
  suspense: string;
}

async function loadSettings(tx: Tx): Promise<Settings> {
  const r = (await tx.query<Row>('SELECT * FROM precompta_settings')).rows[0];
  const banks = (await tx.query<{ id: string; type: string }>('SELECT id, type FROM bank_accounts ORDER BY id')).rows;
  const defaults = defaultJournals(banks.map((b) => ({ id: b.id, type: b.type as 'checking' })));
  const saved = (r?.journals as Partial<Journals> | null) ?? {};
  return {
    provider: (r?.provider as Settings['provider']) ?? 'none',
    software: (r?.software as string | null) ?? null,
    dossierCode: (r?.dossier_code as string | null) ?? null,
    vat: (r?.vat_accounts as VatAccounts | null) ?? DEFAULT_VAT_ACCOUNTS,
    journals: {
      sales: saved.sales ?? defaults.sales,
      purchases: saved.purchases ?? defaults.purchases,
      banks: { ...defaults.banks, ...(saved.banks ?? {}) },
      bankAccounts: { ...defaults.bankAccounts, ...(saved.bankAccounts ?? {}) },
    },
    suspense: (r?.suspense as string) ?? '471000',
  };
}

/** Plan de comptes de la société ; le plan par défaut (et un 512 par banque) est créé au premier accès. */
async function loadChart(tx: Tx, companyId: string, settings: Settings): Promise<LedgerAccount[]> {
  let rows = (await tx.query<Row>('SELECT * FROM ledger_accounts ORDER BY number')).rows;
  if (!rows.length) {
    const names = new Map((await tx.query<{ id: string; name: string }>('SELECT id, coalesce(display_name, name) AS name FROM bank_accounts')).rows.map((b) => [b.id, b.name]));
    const banks = Object.entries(settings.journals.bankAccounts)
      .filter(([, n]) => !DEFAULT_CHART.some((a) => a.number === n))
      .map(([id, number]) => ({ number, label: `Banque · ${names.get(id) ?? id}`.slice(0, 120), type: 'bank' as const }));
    for (const a of [...DEFAULT_CHART, ...banks])
      await tx.query('INSERT INTO ledger_accounts (company_id, number, label, type) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING', [companyId, a.number, a.label, a.type]);
    rows = (await tx.query<Row>('SELECT * FROM ledger_accounts ORDER BY number')).rows;
  }
  return rows.map((r) => ({ number: r.number as string, label: r.label as string, type: r.type as LedgerAccount['type'], hidden: r.hidden as boolean }));
}

async function loadEntries(tx: Tx, ids?: string[]): Promise<Entry[]> {
  const where = ids ? 'WHERE id = ANY($1)' : '';
  const entries = (await tx.query<Row>(`SELECT *, to_char(date, 'YYYY-MM-DD') AS d, to_char(piece_date, 'YYYY-MM-DD') AS pd FROM entries ${where} ORDER BY date, created_at`, ids ? [ids] : [])).rows;
  const lines = (await tx.query<Row>(`SELECT * FROM entry_lines ${ids ? 'WHERE entry_id = ANY($1)' : ''} ORDER BY entry_id, line_no`, ids ? [ids] : [])).rows;
  const byEntry = new Map<string, EntryLine[]>();
  for (const l of lines) {
    const list = byEntry.get(l.entry_id as string) ?? [];
    list.push({
      account: l.account as string,
      auxAccount: (l.aux_account as string | null) ?? null,
      auxLabel: (l.aux_label as string | null) ?? null,
      label: l.label as string,
      debit: Number(l.debit),
      credit: Number(l.credit),
    });
    byEntry.set(l.entry_id as string, list);
  }
  return entries.map((e) => ({
    id: e.id as string,
    sourceType: e.source_type as Entry['sourceType'],
    sourceId: (e.source_id as string | null) ?? null,
    journal: e.journal as string,
    date: e.d as string,
    pieceRef: e.piece_ref as string,
    pieceDate: e.pd as string,
    label: e.label as string,
    status: e.status as Entry['status'],
    number: (e.number as number | null) ?? null,
    validatedAt: e.validated_at ? (e.validated_at as Date).toISOString() : null,
    rejectedReason: (e.rejected_reason as string | null) ?? null,
    lines: byEntry.get(e.id as string) ?? [],
  }));
}

async function writeLines(tx: Tx, companyId: string, entryId: string, lines: EntryLine[]) {
  await tx.query('DELETE FROM entry_lines WHERE entry_id = $1', [entryId]);
  for (const [i, l] of lines.entries()) {
    await tx.query(
      'INSERT INTO entry_lines (company_id, entry_id, line_no, account, aux_account, aux_label, label, debit, credit) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
      [companyId, entryId, i + 1, l.account, l.auxAccount ?? null, l.auxLabel ?? null, l.label ?? '', l.debit || 0, l.credit || 0],
    );
  }
}

const lineSchema = z.object({
  account,
  auxAccount: z.string().max(20).nullable().optional(),
  auxLabel: z.string().max(100).nullable().optional(),
  label: z.string().max(200).default(''),
  debit: z.number().min(0).max(1e10),
  credit: z.number().min(0).max(1e10),
});

export function registerPrecomptaRoutes(app: FastifyInstance) {
  app.get('/precompta', { preHandler: loadCompany }, async (req) =>
    tenant(req, async (tx) => {
      const settings = await loadSettings(tx);
      const chart = await loadChart(tx, req.company!.id, settings);
      const mappings = Object.fromEntries((await tx.query<Row>('SELECT category_id, account FROM category_accounts')).rows.map((r) => [r.category_id, r.account]));
      return { settings, chart, mappings, entries: await loadEntries(tx) };
    }),
  );

  app.put('/precompta/settings', { preHandler: loadCompany }, async (req) => {
    requireRole(req, WRITERS);
    const body = z
      .object({
        provider: z.enum(['none', 'demo', 'other']),
        software: z.string().trim().max(80).nullable(),
        dossierCode: z.string().trim().max(40).nullable(),
        vat: z.object({ deductible: z.record(account), collected: z.record(account) }),
        journals: z.object({
          sales: z.string().trim().min(1).max(10),
          purchases: z.string().trim().min(1).max(10),
          banks: z.record(z.string().trim().min(1).max(10)),
          bankAccounts: z.record(account),
        }),
        suspense: account,
      })
      .partial()
      .parse(req.body);
    return tenant(req, async (tx) => {
      const cur = await loadSettings(tx);
      const next = { ...cur, ...body };
      await tx.query(
        `INSERT INTO precompta_settings (company_id, provider, software, dossier_code, vat_accounts, journals, suspense, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, now())
         ON CONFLICT (company_id) DO UPDATE SET provider = excluded.provider, software = excluded.software, dossier_code = excluded.dossier_code,
           vat_accounts = excluded.vat_accounts, journals = excluded.journals, suspense = excluded.suspense, updated_at = now()`,
        [req.company!.id, next.provider, next.software, next.dossierCode, JSON.stringify(next.vat), JSON.stringify(next.journals), next.suspense],
      );
      await audit(tx, req, 'update', 'precompta_settings', req.company!.id, cur, next);
      return next;
    });
  });

  app.post('/precompta/connection/test', { preHandler: loadCompany }, async (req) =>
    tenant(req, async (tx) => {
      const s = await loadSettings(tx);
      if (s.provider === 'demo') return { ok: true, message: 'Connexion réussie (logiciel de démonstration).' };
      if (s.provider === 'other')
        return { ok: false, message: `La connexion directe à ${s.software || 'votre logiciel'} n’est pas encore disponible : transmettez vos écritures par l’export FEC.` };
      return { ok: false, message: 'Choisissez d’abord votre logiciel comptable.' };
    }),
  );

  // ───────── Plan de comptes ─────────
  app.post('/precompta/accounts', { preHandler: loadCompany }, async (req, reply) => {
    requireRole(req, WRITERS);
    const body = z.object({ number: account, label: z.string().trim().min(1).max(120), type: z.enum(['client', 'supplier', 'bank', 'expense', 'revenue', 'vat', 'general']) }).parse(req.body);
    const created = await tenant(req, async (tx) => {
      const r = await tx.query('INSERT INTO ledger_accounts (company_id, number, label, type) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING', [req.company!.id, body.number, body.label, body.type]);
      if (!r.rowCount) throw badRequest('ledger.exists', `Le compte ${body.number} existe déjà.`);
      await audit(tx, req, 'create', 'ledger_account', body.number, null, body);
      return { ...body, hidden: false };
    });
    return reply.status(201).send(created);
  });

  app.patch('/precompta/accounts/:number', { preHandler: loadCompany }, async (req) => {
    requireRole(req, WRITERS);
    const { number } = z.object({ number: z.string() }).parse(req.params);
    const body = z.object({ label: z.string().trim().min(1).max(120), hidden: z.boolean() }).partial().parse(req.body);
    return tenant(req, async (tx) => {
      const r = await tx.query<Row>('UPDATE ledger_accounts SET label = coalesce($2, label), hidden = coalesce($3, hidden) WHERE number = $1 RETURNING *', [number, body.label ?? null, body.hidden ?? null]);
      if (!r.rowCount) throw notFound('ledger.not_found', 'Compte introuvable.');
      return { number, label: r.rows[0]!.label, type: r.rows[0]!.type, hidden: r.rows[0]!.hidden };
    });
  });

  app.put('/precompta/mappings', { preHandler: loadCompany }, async (req) => {
    requireRole(req, WRITERS);
    const body = z.object({ items: z.array(z.object({ categoryId: z.string(), account: account.nullable() })).min(1).max(500) }).parse(req.body);
    return tenant(req, async (tx) => {
      for (const m of body.items) {
        if (m.account === null) await tx.query('DELETE FROM category_accounts WHERE category_id = $1', [m.categoryId]);
        else
          await tx.query(
            'INSERT INTO category_accounts (company_id, category_id, account) VALUES ($1, $2, $3) ON CONFLICT (company_id, category_id) DO UPDATE SET account = excluded.account',
            [req.company!.id, m.categoryId, m.account],
          );
      }
      await audit(tx, req, 'update', 'category_accounts', req.company!.id, null, body);
      return { ok: true };
    });
  });

  // ───────── Écritures ─────────
  app.post('/precompta/generate', { preHandler: loadCompany }, async (req) => {
    requireRole(req, WRITERS);
    const body = z.object({ from: isoDate, to: isoDate }).parse(req.body);
    return tenant(req, async (tx) => {
      const settings = await loadSettings(tx);
      await loadChart(tx, req.company!.id, settings);
      const categories = (await tx.query<Row>('SELECT * FROM categories')).rows.map(toCategory);
      const mappings = Object.fromEntries((await tx.query<Row>('SELECT category_id, account FROM category_accounts')).rows.map((r) => [r.category_id as string, r.account as string]));
      const commitments = (await tx.query<Row>('SELECT * FROM commitments')).rows.map(toCommitment);
      const transactions = (await tx.query<Row>('SELECT * FROM transactions')).rows.map(toTransaction);
      const reconciliations = (await tx.query<Row>('SELECT * FROM reconciliations')).rows.map(toReconciliation);
      const existing = (await tx.query<Row>('SELECT source_type, source_id FROM entries WHERE source_id IS NOT NULL')).rows.map((r) => ({
        sourceType: r.source_type as Entry['sourceType'],
        sourceId: r.source_id as string,
      }));
      const ctx: PrecomptaContext = { categories, mappings, vat: settings.vat, journals: settings.journals, suspense: settings.suspense };
      const pending = pendingSources(commitments, transactions, existing, body.from, body.to);
      const drafts = [
        ...pending.commitments.map((c) => invoiceEntry(c, ctx)),
        ...pending.transactions.map((t) => transactionEntry(t, ctx, linksOf(t, reconciliations, commitments))),
      ];
      for (const d of drafts) {
        const id = `ent-${randomUUID().slice(0, 12)}`;
        await tx.query(
          `INSERT INTO entries (company_id, id, source_type, source_id, journal, date, piece_ref, piece_date, label) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [req.company!.id, id, d.sourceType, d.sourceId, d.journal, d.date, d.pieceRef, d.pieceDate, d.label || 'Écriture'],
        );
        await writeLines(tx, req.company!.id, id, d.lines);
      }
      await audit(tx, req, 'create', 'entries', req.company!.id, null, { generated: drafts.length, ...body });
      return { generated: drafts.length, entries: await loadEntries(tx) };
    });
  });

  app.patch('/precompta/entries/:id', { preHandler: loadCompany }, async (req) => {
    requireRole(req, WRITERS);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const body = z
      .object({ journal: z.string().trim().min(1).max(10), date: isoDate, label: z.string().trim().min(1).max(200), pieceRef: z.string().trim().min(1).max(40), lines: z.array(lineSchema).min(1).max(50) })
      .partial()
      .parse(req.body);
    return tenant(req, async (tx) => {
      const [e] = await loadEntries(tx, [id]);
      if (!e) throw notFound('entry.not_found', 'Écriture introuvable.');
      if (e.status === 'validated' || e.status === 'sent') throw badRequest('entry.locked', 'Une écriture validée ne se modifie plus.');
      await tx.query(
        `UPDATE entries SET journal = coalesce($2, journal), date = coalesce($3::date, date), label = coalesce($4, label), piece_ref = coalesce($5, piece_ref),
           status = 'draft', rejected_reason = NULL WHERE id = $1`,
        [id, body.journal ?? null, body.date ?? null, body.label ?? null, body.pieceRef ?? null],
      );
      if (body.lines) await writeLines(tx, req.company!.id, id, body.lines as EntryLine[]);
      await audit(tx, req, 'update', 'entry', id, e, body);
      return (await loadEntries(tx, [id]))[0];
    });
  });

  app.post('/precompta/entries/validate', { preHandler: loadCompany }, async (req) => {
    requireRole(req, WRITERS);
    const { ids } = z.object({ ids: z.array(z.string()).min(1).max(2000) }).parse(req.body);
    return tenant(req, async (tx) => {
      const settings = await loadSettings(tx);
      const chart = await loadChart(tx, req.company!.id, settings);
      const entries = (await loadEntries(tx, ids)).filter((e) => e.status === 'draft' || e.status === 'rejected').sort((a, b) => a.date.localeCompare(b.date));
      const refused: { id: string; errors: string[] }[] = [];
      let validated = 0;
      for (const e of entries) {
        const check = checkEntry(e, chart);
        if (!check.ok) {
          refused.push({ id: e.id, errors: check.errors });
          continue;
        }
        // Numérotation continue par journal, dans l'ordre de validation
        const next = Number((await tx.query<{ n: string }>('SELECT coalesce(max(number), 0) + 1 AS n FROM entries WHERE journal = $1', [e.journal])).rows[0]!.n);
        await tx.query("UPDATE entries SET status = 'validated', number = $2, validated_at = now(), rejected_reason = NULL WHERE id = $1", [e.id, next]);
        validated++;
      }
      await audit(tx, req, 'validate', 'entries', req.company!.id, null, { validated, refused: refused.length });
      return { validated, refused, entries: await loadEntries(tx) };
    });
  });

  app.post('/precompta/entries/reject', { preHandler: loadCompany }, async (req) => {
    requireRole(req, WRITERS);
    const body = z.object({ ids: z.array(z.string()).min(1).max(2000), reason: z.string().trim().min(1, 'Indiquez le motif du refus.').max(300) }).parse(req.body);
    return tenant(req, async (tx) => {
      const r = await tx.query("UPDATE entries SET status = 'rejected', rejected_reason = $2 WHERE id = ANY($1) AND status = 'draft'", [body.ids, body.reason]);
      await audit(tx, req, 'reject', 'entries', req.company!.id, null, body);
      return { rejected: r.rowCount ?? 0, entries: await loadEntries(tx) };
    });
  });

  app.post('/precompta/entries/send', { preHandler: loadCompany }, async (req) => {
    requireRole(req, WRITERS);
    const { ids } = z.object({ ids: z.array(z.string()).min(1).max(5000) }).parse(req.body);
    return tenant(req, async (tx) => {
      const r = await tx.query("UPDATE entries SET status = 'sent', sent_at = now() WHERE id = ANY($1) AND status = 'validated'", [ids]);
      await audit(tx, req, 'send', 'entries', req.company!.id, null, { sent: r.rowCount });
      return { sent: r.rowCount ?? 0, entries: await loadEntries(tx) };
    });
  });

  app.delete('/precompta/entries/:id', { preHandler: loadCompany }, async (req, reply) => {
    requireRole(req, WRITERS);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    await tenant(req, async (tx) => {
      const r = await tx.query("DELETE FROM entries WHERE id = $1 AND status IN ('draft', 'rejected')", [id]);
      if (!r.rowCount) throw badRequest('entry.locked', 'Seules les écritures non validées peuvent être supprimées.');
      await audit(tx, req, 'delete', 'entry', id, null, null);
    });
    return reply.status(204).send();
  });

  app.get('/precompta/fec', { preHandler: loadCompany }, async (req) => {
    const q = z.object({ from: isoDate, to: isoDate, closing: isoDate.optional() }).parse(req.query);
    return tenant(req, async (tx) => {
      const settings = await loadSettings(tx);
      const chart = await loadChart(tx, req.company!.id, settings);
      const siren = (await tx.query<{ siren: string | null }>('SELECT siren FROM companies WHERE id = $1', [req.company!.id])).rows[0]?.siren ?? '';
      const labels: Record<string, string> = { [settings.journals.sales]: 'Ventes', [settings.journals.purchases]: 'Achats' };
      for (const code of Object.values(settings.journals.banks)) labels[code] = code === 'CA' ? 'Caisse' : `Banque ${code}`;
      const fec = buildFec({ siren, closingDate: q.closing ?? q.to, from: q.from, to: q.to, entries: await loadEntries(tx), chart, journalLabels: labels });
      await audit(tx, req, 'export', 'fec', req.company!.id, null, { from: q.from, to: q.to, entries: fec.entries, errors: fec.errors.length });
      return fec;
    });
  });
}
