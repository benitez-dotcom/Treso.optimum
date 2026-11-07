/** Factures : conversion des lignes SQL et recalcul du « payé » après un rapprochement. */
import type { Commitment, Reconciliation } from '@optimum/treso-engine';
import type { Tx } from '../db';

type Row = Record<string, unknown>;

const day = (v: unknown): string | null => (v == null ? null : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));

export const toCommitment = (r: Row): Commitment => ({
  id: r.id as string,
  flow: r.flow as Commitment['flow'],
  counterparty: r.counterparty as string,
  number: (r.number as string | null) ?? undefined,
  label: r.label as string,
  amountInclTax: Number(r.amount_incl_tax),
  amountPaid: Number(r.amount_paid ?? 0),
  vatRate: Number(r.vat_rate),
  issuedAt: day(r.issued_at)!,
  dueAt: day(r.due_at)!,
  status: r.status as Commitment['status'],
  categoryId: (r.category_id as string | null) ?? null,
  hidden: r.hidden as boolean,
  accountId: (r.account_id as string | null) ?? null,
  seriesId: (r.series_id as string | null) ?? null,
  seriesIndex: (r.series_index as number | null) ?? null,
  paymentTerms: (r.payment_terms as Commitment['paymentTerms']) ?? null,
  vatAmount: r.vat_amount == null ? null : Number(r.vat_amount),
  note: (r.note as string | null) ?? null,
  source: (r.source as Commitment['source']) ?? 'manual',
  importId: (r.import_id as string | null) ?? null,
  replacedBy: (r.replaced_by as string | null) ?? null,
  notDuplicateOf: (r.not_duplicate_of as string | null) ?? null,
  paidAt: day(r.paid_at),
});

export const toReconciliation = (r: Row): Reconciliation => ({
  id: r.id as string,
  transactionId: r.transaction_id as string,
  commitmentId: r.commitment_id as string,
  amount: Number(r.amount),
});

/**
 * Payé d'une facture = somme de ses rapprochements. Soldée → « Payée » à la
 * date du dernier paiement ; sinon elle reste ouverte pour le reste à payer.
 */
export async function refreshPaid(tx: Tx, commitmentId: string): Promise<Commitment> {
  const r = await tx.query<Row>(
    `UPDATE commitments c SET
       amount_paid = s.paid,
       status = CASE WHEN c.status = 'cancelled' THEN 'cancelled' WHEN s.paid >= c.amount_incl_tax - 0.005 THEN 'paid' ELSE 'pending' END,
       paid_at = CASE WHEN s.paid >= c.amount_incl_tax - 0.005 THEN s.last ELSE NULL END
     FROM (
       SELECT coalesce(sum(r.amount), 0) AS paid, max(t.booked_at) AS last
       FROM reconciliations r JOIN transactions t ON t.company_id = r.company_id AND t.id = r.transaction_id
       WHERE r.commitment_id = $1
     ) s
     WHERE c.id = $1
     RETURNING c.*`,
    [commitmentId],
  );
  return toCommitment(r.rows[0]!);
}
