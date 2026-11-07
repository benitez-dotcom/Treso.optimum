/** Vérification d'une écriture : pièce à gauche, écriture proposée à droite, équilibre en direct. */
import { useEffect, useMemo, useState } from 'react';
import { App, AutoComplete, Button, DatePicker, Drawer, Input, InputNumber, Modal, Tag } from 'antd';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { checkEntry, formatDate, formatEuro, type Entry, type EntryLine, type LedgerAccount } from '@optimum/treso-engine';
import { useStore } from '../../store/useStore';
import { api, ApiError } from '../../api/client';

interface Props {
  entry: Entry | null;
  chart: LedgerAccount[];
  onClose: () => void;
  onChanged: (entries?: Entry[]) => void;
}

export const STATUS: Record<Entry['status'], { label: string; color: string }> = {
  draft: { label: 'À vérifier', color: 'gold' },
  rejected: { label: 'Refusée', color: 'red' },
  validated: { label: 'Validée', color: 'green' },
  sent: { label: 'Envoyée', color: 'blue' },
};

export function EntryDrawer({ entry, chart, onClose, onChanged }: Props) {
  const { message } = App.useApp();
  const s = useStore();
  const [lines, setLines] = useState<EntryLine[]>([]);
  const [head, setHead] = useState({ journal: '', date: '', label: '', pieceRef: '' });
  const [saving, setSaving] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (!entry) return;
    setLines(entry.lines.map((l) => ({ ...l })));
    setHead({ journal: entry.journal, date: entry.date, label: entry.label, pieceRef: entry.pieceRef });
  }, [entry]);

  const locked = entry?.status === 'validated' || entry?.status === 'sent';
  const check = useMemo(() => checkEntry({ ...head, lines }, chart), [head, lines, chart]);
  const dirty = entry ? JSON.stringify(lines) !== JSON.stringify(entry.lines) || head.journal !== entry.journal || head.date !== entry.date || head.label !== entry.label || head.pieceRef !== entry.pieceRef : false;
  const accountOptions = useMemo(() => chart.filter((a) => !a.hidden).map((a) => ({ value: a.number, label: `${a.number} · ${a.label}` })), [chart]);
  const accountLabel = (n: string) => chart.find((a) => a.number === n)?.label;

  const source = useMemo(() => {
    if (!entry?.sourceId) return null;
    if (entry.sourceType === 'commitment') {
      const c = s.commitments.find((x) => x.id === entry.sourceId);
      if (!c) return null;
      const cat = s.categories.find((k) => k.id === c.categoryId)?.name ?? 'À catégoriser';
      return {
        title: c.flow === 'in' ? 'Facture client' : 'Facture fournisseur',
        facts: [
          [c.flow === 'in' ? 'Client' : 'Fournisseur', c.counterparty],
          ['Numéro', c.number || '—'],
          ['Date', formatDate(c.issuedAt)],
          ['Échéance', formatDate(c.dueAt)],
          ['Montant TTC', formatEuro(c.amountInclTax)],
          ['TVA', `${c.vatRate.toLocaleString('fr-FR')} %${c.vatAmount ? ` · ${formatEuro(c.vatAmount)}` : ''}`],
          ['Catégorie', cat],
        ],
      };
    }
    const t = s.transactions.find((x) => x.id === entry.sourceId);
    if (!t) return null;
    const acc = s.accounts.find((a) => a.id === t.accountId);
    const recs = s.reconciliations.filter((r) => r.transactionId === t.id);
    return {
      title: 'Opération bancaire',
      facts: [
        ['Date', formatDate(t.bookedAt)],
        ['Libellé', t.rawLabel],
        ['Tiers', t.counterparty || '—'],
        ['Montant', formatEuro(t.amount)],
        ['Compte', acc ? acc.displayName || acc.name : '—'],
        ['Catégorie', s.categories.find((k) => k.id === t.categoryId)?.name ?? 'À catégoriser'],
        ['Factures rapprochées', recs.length ? String(recs.length) : 'Aucune'],
      ],
    };
  }, [entry, s.commitments, s.transactions, s.categories, s.accounts, s.reconciliations]);

  const setLine = (i: number, p: Partial<EntryLine>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...p } : l)));

  const save = async (): Promise<boolean> => {
    if (!entry || !dirty) return true;
    setSaving(true);
    try {
      await api('PATCH', `/precompta/entries/${entry.id}`, { ...head, lines });
      return true;
    } catch (e) {
      message.error(e instanceof ApiError ? e.message : 'Enregistrement impossible.');
      return false;
    } finally {
      setSaving(false);
    }
  };

  const validate = async () => {
    if (!entry || !(await save())) return;
    const r = await api<{ validated: number; refused: { errors: string[] }[]; entries: Entry[] }>('POST', '/precompta/entries/validate', { ids: [entry.id] });
    if (r.validated) {
      message.success('Écriture validée');
      onChanged(r.entries);
      onClose();
    } else message.error(r.refused[0]?.errors.join(' ; ') ?? 'Validation impossible.');
  };

  return (
    <Drawer
      open={entry !== null}
      onClose={onClose}
      width={980}
      title={
        entry && (
          <span className="entry-title">
            {entry.label} <Tag color={STATUS[entry.status].color}>{STATUS[entry.status].label}</Tag>
            {entry.number && <span className="muted">n° {entry.number}</span>}
          </span>
        )
      }
      destroyOnHidden
      footer={
        entry &&
        !locked && (
          <div className="drawer-footer">
            {entry.status !== 'validated' && (
              <Button
                danger
                type="text"
                onClick={async () => {
                  await api('DELETE', `/precompta/entries/${entry.id}`);
                  message.success('Écriture supprimée : elle sera proposée à nouveau à la prochaine génération.');
                  onChanged();
                  onClose();
                }}
              >
                Supprimer
              </Button>
            )}
            <span className="spacer" />
            <Button onClick={() => setRejecting(true)}>Refuser</Button>
            <Button
              loading={saving}
              disabled={!dirty}
              onClick={async () => {
                if (await save()) {
                  message.success('Écriture enregistrée');
                  onChanged();
                }
              }}
            >
              Enregistrer
            </Button>
            <Button type="primary" disabled={!check.ok} onClick={validate}>
              Valider
            </Button>
          </div>
        )
      }
    >
      {entry && (
        <div className="entry-layout">
          <aside className="entry-source">
            <h3>{source?.title ?? 'Pièce'}</h3>
            {source ? (
              <dl className="op-facts">
                {source.facts.map(([k, v]) => (
                  <div key={k} style={{ display: 'contents' }}>
                    <dt>{k}</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="muted">Pièce introuvable (supprimée depuis).</p>
            )}
            {entry.rejectedReason && <p className="warn-text">Refusée : {entry.rejectedReason}</p>}
          </aside>
          <section className="entry-main">
            <div className="entry-head">
              <label>
                Journal
                <Input value={head.journal} maxLength={10} disabled={locked} onChange={(e) => setHead({ ...head, journal: e.target.value.toUpperCase() })} style={{ width: 90 }} />
              </label>
              <label>
                Date
                <DatePicker value={head.date ? dayjs(head.date) : null} format="DD/MM/YYYY" allowClear={false} disabled={locked} onChange={(d) => d && setHead({ ...head, date: d.format('YYYY-MM-DD') })} />
              </label>
              <label>
                Pièce
                <Input value={head.pieceRef} maxLength={40} disabled={locked} onChange={(e) => setHead({ ...head, pieceRef: e.target.value })} style={{ width: 160 }} />
              </label>
              <label className="grow">
                Libellé
                <Input value={head.label} maxLength={200} disabled={locked} onChange={(e) => setHead({ ...head, label: e.target.value })} />
              </label>
            </div>
            <table className="entry-lines">
              <thead>
                <tr>
                  <th>Compte</th>
                  <th>Libellé</th>
                  <th className="num">Débit</th>
                  <th className="num">Crédit</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={i}>
                    <td>
                      <AutoComplete
                        value={l.account}
                        options={accountOptions}
                        filterOption={(input, o) => String(o?.label ?? '').toLowerCase().includes(input.toLowerCase())}
                        onChange={(v) => setLine(i, { account: String(v).split(' ')[0]! })}
                        disabled={locked}
                        style={{ width: 130 }}
                        aria-label={`Compte ligne ${i + 1}`}
                      />
                      <div className="muted acc-label">
                        {accountLabel(l.account) ?? 'Compte inconnu'}
                        {l.auxAccount ? ` · ${l.auxAccount}` : ''}
                      </div>
                    </td>
                    <td>
                      <Input value={l.label} disabled={locked} onChange={(e) => setLine(i, { label: e.target.value })} aria-label={`Libellé ligne ${i + 1}`} />
                    </td>
                    <td className="num">
                      <InputNumber value={l.debit || null} min={0} precision={2} decimalSeparator="," disabled={locked} onChange={(v) => setLine(i, { debit: v ?? 0, ...(v ? { credit: 0 } : {}) })} aria-label={`Débit ligne ${i + 1}`} />
                    </td>
                    <td className="num">
                      <InputNumber value={l.credit || null} min={0} precision={2} decimalSeparator="," disabled={locked} onChange={(v) => setLine(i, { credit: v ?? 0, ...(v ? { debit: 0 } : {}) })} aria-label={`Crédit ligne ${i + 1}`} />
                    </td>
                    <td>
                      {!locked && (
                        <Button type="text" size="small" icon={<DeleteOutlined />} aria-label={`Supprimer la ligne ${i + 1}`} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={2}>
                    {!locked && (
                      <Button size="small" icon={<PlusOutlined />} onClick={() => setLines((ls) => [...ls, { account: '471000', label: head.label, debit: 0, credit: 0 }])}>
                        Ajouter une ligne
                      </Button>
                    )}
                  </td>
                  <td className="num">
                    <strong>{formatEuro(check.debit)}</strong>
                  </td>
                  <td className="num">
                    <strong>{formatEuro(check.credit)}</strong>
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
            {!locked && (
              <div className={`balance ${check.ok ? 'ok' : 'ko'}`} role="status">
                {check.ok ? 'Écriture équilibrée' : check.errors.join(' · ')}
              </div>
            )}
          </section>
        </div>
      )}

      <Modal
        open={rejecting}
        title="Refuser l’écriture"
        okText="Refuser"
        okButtonProps={{ danger: true, disabled: !reason.trim() }}
        cancelText="Annuler"
        onCancel={() => setRejecting(false)}
        onOk={async () => {
          if (!entry) return;
          const r = await api<{ entries: Entry[] }>('POST', '/precompta/entries/reject', { ids: [entry.id], reason });
          setRejecting(false);
          setReason('');
          message.success('Écriture refusée');
          onChanged(r.entries);
          onClose();
        }}
      >
        <Input.TextArea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Motif (ex. : pièce justificative manquante)" maxLength={300} autoSize={{ minRows: 2 }} />
      </Modal>
    </Drawer>
  );
}
