/** Données enrichies des factures : statut, reste à payer, compte en cascade, rapprochements. */
import { useMemo } from 'react';
import {
  findDuplicates,
  invoiceAccount,
  invoiceStatus,
  reconciliationCandidates,
  remainingOf,
  type AccountSource,
  type Commitment,
  type Flow,
  type InvoiceStatus,
} from '@optimum/treso-engine';
import { useStore } from '../../store/useStore';
import { accountLabel } from '../../api/types';

export interface InvoiceRow {
  c: Commitment;
  status: InvoiceStatus;
  daysLate: number;
  remaining: number;
  accountId: string | null;
  accountSource: AccountSource;
  accountText: string;
  hasSuggestion: boolean;
  isDuplicate: boolean;
}

export function useInvoiceRows(flow: Flow) {
  const commitments = useStore((s) => s.commitments);
  const categories = useStore((s) => s.categories);
  const accounts = useStore((s) => s.accounts);
  const transactions = useStore((s) => s.transactions);
  const reconciliations = useStore((s) => s.reconciliations);
  const today = useStore((s) => s.today);

  return useMemo(() => {
    const defaultAccountId = accounts.find((a) => a.isDefaultForCommitments)?.id ?? null;
    const mine = commitments.filter((c) => c.flow === flow && !c.replacedBy);
    const duplicates = findDuplicates(commitments.filter((c) => c.flow === flow));
    const dupIds = new Set(duplicates.flatMap((p) => [p.manual.id, p.imported.id]));
    const suggestions = reconciliationCandidates(transactions, mine, reconciliations, { minScore: 50 });
    const withSuggestion = new Set(suggestions.map((s) => s.commitment.id));
    const byAccount = new Map(accounts.map((a) => [a.id, a]));
    const rows: InvoiceRow[] = mine.map((c) => {
      const st = invoiceStatus(c, today);
      const acc = invoiceAccount(c, { commitments, categories, defaultAccountId });
      const a = acc.accountId ? byAccount.get(acc.accountId) : undefined;
      return {
        c,
        status: st.status,
        daysLate: st.daysLate,
        remaining: remainingOf(c),
        accountId: acc.accountId,
        accountSource: acc.source,
        accountText: a ? `${accountLabel(a)}${a.bankName ? ` · ${a.bankName}` : ''}${acc.source === 'invoice' ? '' : ' (par défaut)'}` : 'Par défaut',
        hasSuggestion: withSuggestion.has(c.id) && st.status !== 'paid',
        isDuplicate: dupIds.has(c.id),
      };
    });
    return { rows, duplicates, suggestions, defaultAccountId };
  }, [commitments, categories, accounts, transactions, reconciliations, today, flow]);
}
