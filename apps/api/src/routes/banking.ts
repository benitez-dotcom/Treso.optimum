/**
 * Banques (écran 7.10) : connexions via l'agrégateur ou la banque de
 * démonstration, synchronisation, comptes (réglages, comptes manuels).
 */
import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { createBridgeProvider } from '../banking/bridge';
import { demoProvider } from '../banking/demo';
import { ProviderError, type BankProvider, type SyncResult } from '../banking/provider';
import { ADMINS, audit, loadCompany, requireRole, tenant, WRITERS } from '../context';
import type { Tx } from '../db';
import { ApiError, badRequest, forbidden, notFound } from '../errors';
import { ingestTransactions, refreshManualBalances } from '../services/operations';

type Row = Record<string, unknown>;

/** Offres limitées à une banque connectée (les comptes manuels ne comptent pas). */
const ONE_BANK_PLANS = new Set(['DISCOVERY', 'ESSENTIAL']);

const balanceColumn = { balance: 'balance_provider', booked: 'booked_balance', instant: 'instant_balance' } as const;

export const accountDto = (a: Row) => ({
  id: a.id as string,
  name: a.name as string,
  displayName: (a.display_name as string | null) ?? null,
  bankName: a.bank_name as string,
  balance: a.balance as number,
  isActive: a.is_active as boolean,
  connectionId: (a.connection_id as string | null) ?? null,
  type: a.type as string,
  balances: { balance: (a.balance_provider as number | null) ?? null, booked: (a.booked_balance as number | null) ?? null, instant: (a.instant_balance as number | null) ?? null },
  balanceSource: a.balance_source as string,
  isManual: a.is_manual as boolean,
  openingBalance: (a.opening_balance as number | null) ?? null,
  openingDate: (a.opening_date as string | null) ?? null,
  isDefaultForCommitments: a.is_default_for_commitments as boolean,
  ignoreDeferredCard: a.ignore_deferred_card as boolean,
  ibanMasked: (a.iban_masked as string | null) ?? null,
  lastSyncAt: (a.last_sync_at as Date | null) ?? null,
});

export const connectionDto = (c: Row) => ({
  id: c.id as string,
  provider: c.provider as string,
  bankName: c.bank_name as string,
  status: c.status as string,
  statusDetail: (c.status_detail as string | null) ?? null,
  lastSyncAt: (c.last_sync_at as Date | null) ?? null,
});

export function providers(app: FastifyInstance): Record<string, BankProvider> {
  const out: Record<string, BankProvider> = { demo: demoProvider };
  const cfg = app.deps.config.bridge;
  if (cfg) out.bridge = createBridgeProvider(cfg);
  return out;
}

/** Erreur d'agrégateur traduite pour l'utilisateur, détail technique dans les journaux. */
function providerFailure(req: FastifyRequest, err: unknown): ApiError {
  req.log.warn({ err }, 'Agrégateur bancaire en erreur');
  if (err instanceof ProviderError) {
    return new ApiError(502, 'bank.provider_error', "Votre banque ne répond pas pour le moment. Réessayez dans quelques minutes.");
  }
  return err instanceof ApiError ? err : new ApiError(502, 'bank.provider_error', "La connexion bancaire n'a pas abouti.");
}

/** Enregistre le résultat d'une synchronisation : comptes, soldes, opérations. */
async function applySync(tx: Tx, req: FastifyRequest, connectionId: string, result: SyncResult): Promise<{ accounts: number; imported: number }> {
  const companyId = req.company!.id;
  const accountIds = new Map<string, string>();
  for (const a of result.accounts) {
    const existing = (
      await tx.query<{ id: string }>('SELECT id FROM bank_accounts WHERE connection_id = $1 AND provider_account_id = $2', [connectionId, a.providerAccountId])
    ).rows[0];
    const id = existing?.id ?? `acc-${randomUUID().slice(0, 8)}`;
    accountIds.set(a.providerAccountId, id);
    if (existing) {
      await tx.query(
        `UPDATE bank_accounts SET name = $2, bank_name = $3, balance_provider = $4, booked_balance = $5, instant_balance = $6,
           iban_masked = $7, type = $8, last_sync_at = now() WHERE id = $1`,
        [id, a.name, result.bankName, a.balance, a.bookedBalance, a.instantBalance, a.ibanMasked, a.type],
      );
    } else {
      // Les comptes d'épargne et de crédit sont exclus de la trésorerie par défaut
      const active = a.type === 'checking' || a.type === 'card';
      await tx.query(
        `INSERT INTO bank_accounts (company_id, id, name, bank_name, balance, is_active, connection_id, provider_account_id,
           balance_provider, booked_balance, instant_balance, type, currency, iban_masked, last_sync_at)
         VALUES ($1, $2, $3, $4, 0, $5, $6, $7, $8, $9, $10, $11, $12, $13, now())`,
        [companyId, id, a.name, result.bankName, active, connectionId, a.providerAccountId, a.balance, a.bookedBalance, a.instantBalance, a.type, a.currency, a.ibanMasked],
      );
    }
  }
  // Solde retenu selon le choix de l'utilisateur (repli sur le solde fourni)
  await tx.query(
    `UPDATE bank_accounts SET balance = coalesce(CASE balance_source
        WHEN 'booked' THEN booked_balance WHEN 'instant' THEN instant_balance ELSE balance_provider END, balance_provider, 0)
     WHERE connection_id = $1`,
    [connectionId],
  );
  const created = await ingestTransactions(
    tx,
    companyId,
    req.userId ?? null,
    result.transactions
      .filter((t) => accountIds.has(t.providerAccountId))
      .map((t) => ({
        accountId: accountIds.get(t.providerAccountId)!,
        bookedAt: t.bookedAt,
        rawLabel: t.rawLabel,
        amount: t.amount,
        source: 'bank' as const,
        providerTransactionId: t.providerTransactionId,
      })),
  );
  await tx.query('UPDATE bank_connections SET bank_name = $2, status = $3, status_detail = $4, last_sync_at = now() WHERE id = $1', [
    connectionId, result.bankName, result.status, result.statusDetail,
  ]);
  return { accounts: result.accounts.length, imported: created.length };
}

/** Synchronise une connexion : appel à l'agrégateur hors transaction, puis enregistrement. */
async function syncConnection(app: FastifyInstance, req: FastifyRequest, connectionId: string) {
  const conn = await tenant(req, async (tx) => (await tx.query<Row>('SELECT * FROM bank_connections WHERE id = $1', [connectionId])).rows[0]);
  if (!conn) throw notFound('bank.connection_not_found', 'Connexion bancaire introuvable.');
  const provider = providers(app)[conn.provider as string];
  if (!provider) throw badRequest('bank.provider_unavailable', "Cet agrégateur bancaire n'est pas configuré sur ce serveur.");
  const since = conn.last_sync_at ? new Date((conn.last_sync_at as Date).getTime() - 7 * 86_400_000).toISOString() : null;
  let result: SyncResult;
  try {
    result = await provider.sync(req.company!.id, conn.provider_connection_id as string, since);
  } catch (err) {
    await tenant(req, (tx) =>
      tx.query("UPDATE bank_connections SET status = 'error', status_detail = $2 WHERE id = $1", [connectionId, 'Synchronisation impossible']),
    );
    throw providerFailure(req, err);
  }
  return tenant(req, async (tx) => {
    const r = await applySync(tx, req, connectionId, result);
    await audit(tx, req, 'sync', 'bank_connection', connectionId, null, r);
    const c = (await tx.query<Row>('SELECT * FROM bank_connections WHERE id = $1', [connectionId])).rows[0]!;
    return { connection: connectionDto(c), ...r };
  });
}

async function assertBankLimit(tx: Tx, req: FastifyRequest) {
  const plan = (await tx.query<{ plan: string }>('SELECT plan FROM companies WHERE id = $1', [req.company!.id])).rows[0]?.plan;
  if (!plan || !ONE_BANK_PLANS.has(plan)) return;
  const n = Number((await tx.query<{ n: string }>('SELECT count(*) AS n FROM bank_connections')).rows[0]!.n);
  if (n >= 1) throw forbidden('bank.limit', 'Votre offre inclut 1 banque. Passez à Performance pour en ajouter.');
}

export function registerBankingRoutes(app: FastifyInstance) {
  /** Agrégateurs disponibles sur ce serveur. */
  app.get('/bank-providers', { preHandler: loadCompany }, async () => ({ demo: true, bridge: Boolean(app.deps.config.bridge) }));

  app.get('/bank-connections', { preHandler: loadCompany }, async (req) =>
    tenant(req, async (tx) => ({
      connections: (await tx.query<Row>('SELECT * FROM bank_connections ORDER BY created_at')).rows.map(connectionDto),
      accounts: (await tx.query<Row>('SELECT * FROM bank_accounts ORDER BY is_manual, name')).rows.map(accountDto),
    })),
  );

  /** Démarre une connexion : immédiate pour la démo, redirection pour Bridge. */
  app.post('/bank-connections/link', { preHandler: loadCompany }, async (req, reply) => {
    requireRole(req, ADMINS);
    const body = z.object({ provider: z.enum(['demo', 'bridge']), connectionId: z.string().optional() }).parse(req.body);
    const provider = providers(app)[body.provider];
    if (!provider) throw badRequest('bank.provider_unavailable', "La connexion à votre banque n'est pas encore configurée sur ce serveur. Utilisez la banque de démonstration ou un compte manuel.");

    let existing: Row | undefined;
    if (body.connectionId) {
      existing = await tenant(req, async (tx) => (await tx.query<Row>('SELECT * FROM bank_connections WHERE id = $1', [body.connectionId])).rows[0]);
      if (!existing) throw notFound('bank.connection_not_found', 'Connexion bancaire introuvable.');
    } else {
      await tenant(req, (tx) => assertBankLimit(tx, req));
    }
    const email = await tenant(req, async (tx) => (await tx.query<{ email: string }>('SELECT email FROM users WHERE id = $1', [req.userId])).rows[0]!.email);

    let linked: Awaited<ReturnType<BankProvider['link']>>;
    try {
      linked = await provider.link({
        companyId: req.company!.id,
        userEmail: email,
        callbackUrl: `${app.deps.config.appUrl}/parametres/banques/retour`,
        providerConnectionId: (existing?.provider_connection_id as string | null) ?? null,
      });
    } catch (err) {
      throw providerFailure(req, err);
    }
    if ('redirectUrl' in linked) return { redirectUrl: linked.redirectUrl };

    const id = (existing?.id as string | undefined) ?? `bc-${randomUUID().slice(0, 8)}`;
    if (!existing) {
      await tenant(req, async (tx) => {
        await tx.query(
          'INSERT INTO bank_connections (company_id, id, provider, provider_connection_id, bank_name) VALUES ($1, $2, $3, $4, $5)',
          [req.company!.id, id, body.provider, linked.providerConnectionId, 'Connexion en cours'],
        );
        await audit(tx, req, 'create', 'bank_connection', id, null, { provider: body.provider });
      });
    }
    const result = await syncConnection(app, req, id);
    return reply.status(existing ? 200 : 201).send(result);
  });

  /** Retour de l'agrégateur (Bridge renvoie `item_id`). */
  app.post('/bank-connections/callback', { preHandler: loadCompany }, async (req) => {
    requireRole(req, ADMINS);
    const body = z.object({ provider: z.literal('bridge'), itemId: z.string().regex(/^\d+$/), success: z.boolean().default(true) }).parse(req.body);
    if (!body.success) throw badRequest('bank.link_cancelled', "La connexion bancaire n'a pas été finalisée. Vous pouvez recommencer quand vous voulez.");
    const id = await tenant(req, async (tx) => {
      const found = (await tx.query<{ id: string }>("SELECT id FROM bank_connections WHERE provider = 'bridge' AND provider_connection_id = $1", [body.itemId])).rows[0];
      if (found) return found.id;
      await assertBankLimit(tx, req);
      const newId = `bc-${randomUUID().slice(0, 8)}`;
      await tx.query("INSERT INTO bank_connections (company_id, id, provider, provider_connection_id, bank_name) VALUES ($1, $2, 'bridge', $3, 'Connexion en cours')", [
        req.company!.id, newId, body.itemId,
      ]);
      await audit(tx, req, 'create', 'bank_connection', newId, null, { provider: 'bridge' });
      return newId;
    });
    return syncConnection(app, req, id);
  });

  app.post('/bank-connections/:id/sync', { preHandler: loadCompany }, async (req) => {
    requireRole(req, WRITERS);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    return syncConnection(app, req, id);
  });

  /** Déconnecte une banque : opérations et catégories conservées, comptes détachés et exclus. */
  app.delete('/bank-connections/:id', { preHandler: loadCompany }, async (req, reply) => {
    requireRole(req, ADMINS);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const conn = await tenant(req, async (tx) => (await tx.query<Row>('SELECT * FROM bank_connections WHERE id = $1', [id])).rows[0]);
    if (!conn) throw notFound('bank.connection_not_found', 'Connexion bancaire introuvable.');
    const provider = providers(app)[conn.provider as string];
    await provider?.disconnect(req.company!.id, conn.provider_connection_id as string).catch((err: unknown) => req.log.warn({ err }, 'Révocation agrégateur impossible'));
    await tenant(req, async (tx) => {
      await tx.query('UPDATE bank_accounts SET is_active = false, is_default_for_commitments = false WHERE connection_id = $1', [id]);
      await tx.query('DELETE FROM bank_connections WHERE id = $1', [id]);
      await audit(tx, req, 'delete', 'bank_connection', id, connectionDto(conn), null);
    });
    return reply.status(204).send();
  });

  /** Compte manuel (caisse, banque non couverte). */
  app.post('/bank-accounts', { preHandler: loadCompany }, async (req, reply) => {
    requireRole(req, ADMINS);
    const body = z
      .object({
        name: z.string().trim().min(1, 'Donnez un nom au compte.').max(80),
        bankName: z.string().trim().max(80).default('Compte manuel'),
        type: z.enum(['checking', 'savings', 'cash', 'other']).default('cash'),
        openingBalance: z.number().min(-1e10).max(1e10),
        openingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date invalide.'),
      })
      .parse(req.body);
    const id = `acc-${randomUUID().slice(0, 8)}`;
    return tenant(req, async (tx) => {
      await tx.query(
        `INSERT INTO bank_accounts (company_id, id, name, bank_name, balance, is_active, type, is_manual, opening_balance, opening_date)
         VALUES ($1, $2, $3, $4, $5, true, $6, true, $5, $7)`,
        [req.company!.id, id, body.name, body.bankName, body.openingBalance, body.type, body.openingDate],
      );
      await refreshManualBalances(tx);
      await audit(tx, req, 'create', 'bank_account', id, null, body);
      const a = (await tx.query<Row>('SELECT * FROM bank_accounts WHERE id = $1', [id])).rows[0]!;
      reply.status(201);
      return accountDto(a);
    });
  });

  app.patch('/bank-accounts/:id', { preHandler: loadCompany }, async (req) => {
    requireRole(req, ADMINS);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const body = z
      .object({
        displayName: z.string().trim().max(80).nullable(),
        isActive: z.boolean(),
        balanceSource: z.enum(['balance', 'booked', 'instant']),
        ignoreDeferredCard: z.boolean(),
        isDefaultForCommitments: z.boolean(),
        openingBalance: z.number().min(-1e10).max(1e10),
        openingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      })
      .partial()
      .strict()
      .parse(req.body);
    return tenant(req, async (tx) => {
      const before = (await tx.query<Row>('SELECT * FROM bank_accounts WHERE id = $1', [id])).rows[0];
      if (!before) throw notFound('bank.account_not_found', 'Compte introuvable.');
      const willBeActive = body.isActive ?? (before.is_active as boolean);
      if (body.isDefaultForCommitments && !willBeActive) {
        throw badRequest('bank.default_requires_active', 'Incluez ce compte dans la trésorerie avant d’en faire le compte par défaut des factures.');
      }
      if (body.balanceSource) {
        const col = balanceColumn[body.balanceSource];
        if (!before.is_manual && before[col] === null) throw badRequest('bank.balance_unavailable', 'Ce solde n’est pas fourni par votre banque.');
      }
      if ((body.openingBalance !== undefined || body.openingDate) && !before.is_manual) {
        throw badRequest('bank.not_manual', 'Le solde d’ouverture ne concerne que les comptes manuels.');
      }
      if (body.isDefaultForCommitments) await tx.query('UPDATE bank_accounts SET is_default_for_commitments = false WHERE is_default_for_commitments');
      await tx.query(
        `UPDATE bank_accounts SET
           display_name = CASE WHEN $2 THEN $3 ELSE display_name END,
           is_active = coalesce($4, is_active),
           balance_source = coalesce($5, balance_source),
           ignore_deferred_card = coalesce($6, ignore_deferred_card),
           is_default_for_commitments = CASE WHEN coalesce($4, is_active) THEN coalesce($7, is_default_for_commitments) ELSE false END,
           opening_balance = coalesce($8, opening_balance),
           opening_date = coalesce($9, opening_date)
         WHERE id = $1`,
        [
          id, 'displayName' in body, body.displayName || null, body.isActive ?? null, body.balanceSource ?? null, body.ignoreDeferredCard ?? null,
          body.isDefaultForCommitments ?? null, body.openingBalance ?? null, body.openingDate ?? null,
        ],
      );
      if (!before.is_manual) {
        await tx.query(
          `UPDATE bank_accounts SET balance = coalesce(CASE balance_source
              WHEN 'booked' THEN booked_balance WHEN 'instant' THEN instant_balance ELSE balance_provider END, balance_provider, balance)
           WHERE id = $1`,
          [id],
        );
      } else await refreshManualBalances(tx);
      const after = (await tx.query<Row>('SELECT * FROM bank_accounts WHERE id = $1', [id])).rows[0]!;
      await audit(tx, req, 'update', 'bank_account', id, accountDto(before), body);
      return accountDto(after);
    });
  });

  /** Supprime un compte manuel et ses opérations. */
  app.delete('/bank-accounts/:id', { preHandler: loadCompany }, async (req, reply) => {
    requireRole(req, ADMINS);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    await tenant(req, async (tx) => {
      const a = (await tx.query<Row>('SELECT * FROM bank_accounts WHERE id = $1', [id])).rows[0];
      if (!a) throw notFound('bank.account_not_found', 'Compte introuvable.');
      if (!a.is_manual && a.connection_id) {
        throw badRequest('bank.account_connected', 'Ce compte est synchronisé : déconnectez la banque ou excluez le compte de la trésorerie.');
      }
      await tx.query('DELETE FROM bank_accounts WHERE id = $1', [id]);
      await audit(tx, req, 'delete', 'bank_account', id, accountDto(a), null);
    });
    return reply.status(204).send();
  });
}
