/**
 * Arrivée des opérations (synchronisation bancaire, saisie, import) :
 * nettoyage du libellé, règles automatiques, suggestions, exclusions
 * automatiques ; mise à jour des soldes des comptes manuels.
 */
import { randomUUID } from 'node:crypto';
import {
  categorizeIncoming,
  cleanBankLabel,
  detectAutoExclusions,
  type Rule,
  type Transaction,
  type TransactionSource,
} from '@optimum/treso-engine';
import type { Tx } from '../db';

export interface NewTransaction {
  accountId: string;
  bookedAt: string;
  rawLabel: string;
  amount: number;
  source: TransactionSource;
  categoryId?: string | null;
  note?: string | null;
  importId?: string | null;
  providerTransactionId?: string | null;
}

type Row = Record<string, unknown>;

export const toTransaction = (r: Row): Transaction => ({
  id: r.id as string,
  accountId: r.account_id as string,
  bookedAt: r.booked_at as string,
  rawLabel: r.raw_label as string,
  label: r.label as string,
  counterparty: (r.counterparty as string | null) ?? undefined,
  amount: r.amount as number,
  categoryId: (r.category_id as string | null) ?? null,
  suggestion: (r.suggestion as Transaction['suggestion']) ?? null,
  hidden: r.hidden as boolean,
  note: (r.note as string | null) ?? undefined,
  originalBookedAt: (r.original_booked_at as string | null) ?? null,
  parentId: (r.parent_id as string | null) ?? null,
  isSplit: (r.is_split as boolean | undefined) ?? false,
  source: (r.source as TransactionSource | undefined) ?? 'bank',
  importId: (r.import_id as string | null) ?? null,
  hiddenReason: (r.hidden_reason as Transaction['hiddenReason']) ?? null,
});

export const toRule = (r: Row): Rule => ({
  id: r.id as string,
  conditions: r.conditions as Rule['conditions'],
  categoryId: r.category_id as string,
  autoApply: r.auto_apply as boolean,
  priority: r.priority as number,
});

export const newTransactionId = () => `t-${randomUUID()}`;

/**
 * Insère des opérations après catégorisation assistée (règle 5.10).
 * Les doublons d'agrégateur (même compte, même identifiant fournisseur) sont ignorés.
 * Renvoie les identifiants réellement créés.
 */
export async function ingestTransactions(tx: Tx, companyId: string, userId: string | null, incoming: NewTransaction[]): Promise<string[]> {
  if (incoming.length === 0) return [];
  const rules = (await tx.query<Row>('SELECT * FROM rules ORDER BY priority DESC')).rows.map(toRule);
  const history = (
    await tx.query<Row>("SELECT * FROM transactions WHERE category_id IS NOT NULL AND NOT is_split AND booked_at >= now() - interval '18 months'")
  ).rows.map(toTransaction);

  const drafts: (Transaction & { meta: NewTransaction })[] = incoming.map((n) => {
    const { label, counterparty } = cleanBankLabel(n.rawLabel);
    return {
      id: newTransactionId(),
      accountId: n.accountId,
      bookedAt: n.bookedAt,
      rawLabel: n.rawLabel,
      label,
      counterparty: counterparty ?? undefined,
      amount: n.amount,
      categoryId: n.categoryId ?? null,
      hidden: false,
      meta: n,
    };
  });
  const categorized = categorizeIncoming(drafts, rules, history);

  const created: string[] = [];
  for (let i = 0; i < categorized.length; i++) {
    const t = categorized[i]!;
    const n = drafts[i]!.meta;
    const r = await tx.query(
      `INSERT INTO transactions (company_id, id, account_id, booked_at, raw_label, label, counterparty, amount, category_id, suggestion,
                                 hidden, note, source, import_id, provider_transaction_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, false, $11, $12, $13, $14, $15)
       ON CONFLICT (company_id, account_id, provider_transaction_id) WHERE provider_transaction_id IS NOT NULL DO NOTHING`,
      [
        companyId, t.id, t.accountId, t.bookedAt, t.rawLabel, t.label, t.counterparty ?? null, t.amount, t.categoryId,
        t.suggestion ? JSON.stringify(t.suggestion) : null, n.note ?? null, n.source, n.importId ?? null, n.providerTransactionId ?? null, userId,
      ],
    );
    if (r.rowCount) created.push(t.id);
  }
  if (created.length) await applyAutoExclusions(tx);
  return created;
}

/** Exclusions automatiques (remboursements, virements internes) selon les réglages de la société. */
export async function applyAutoExclusions(tx: Tx): Promise<number> {
  const s = (await tx.query<{ auto_hide_refunds: boolean; auto_hide_internal_transfers: boolean }>(
    'SELECT auto_hide_refunds, auto_hide_internal_transfers FROM companies WHERE id = app_company_id()',
  )).rows[0];
  if (!s || (!s.auto_hide_refunds && !s.auto_hide_internal_transfers)) return 0;
  const candidates = (
    await tx.query<Row>(
      `SELECT * FROM transactions WHERE NOT hidden AND category_id IS NULL AND parent_id IS NULL AND NOT is_split
       AND booked_at >= now() - interval '120 days'`,
    )
  ).rows.map(toTransaction);
  const found = detectAutoExclusions(candidates, { refunds: s.auto_hide_refunds, internalTransfers: s.auto_hide_internal_transfers });
  for (const [id, reason] of found) {
    await tx.query('UPDATE transactions SET hidden = true, hidden_reason = $2, suggestion = NULL WHERE id = $1', [id, reason]);
  }
  return found.size;
}

/** Solde d'un compte manuel = solde d'ouverture + opérations depuis la date d'ouverture. */
export async function refreshManualBalances(tx: Tx): Promise<void> {
  await tx.query(
    `UPDATE bank_accounts a SET balance = a.opening_balance + coalesce((
       SELECT sum(t.amount) FROM transactions t
       WHERE t.company_id = a.company_id AND t.account_id = a.id AND t.parent_id IS NULL AND t.booked_at >= a.opening_date
     ), 0)
     WHERE a.is_manual`,
  );
}
