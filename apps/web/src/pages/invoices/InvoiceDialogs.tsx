/** Actions sur une facture : rapprocher, marquer payée, décaler, relancer. */
import { useEffect, useMemo, useState } from 'react';
import { App, Button, DatePicker, Empty, Input, InputNumber, Modal, Radio, Select, Tag } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import {
  allocatedOf,
  formatDate,
  formatEuro,
  matchScore,
  remainingOf,
  type Commitment,
  type SeriesScope,
} from '@optimum/treso-engine';
import { api, ApiError } from '../../api/client';
import { accountLabel } from '../../api/types';
import { useStore } from '../../store/useStore';

const iso = (d: Dayjs) => d.format('YYYY-MM-DD');

/** « Rapprocher d'un paiement » : opérations candidates triées par score, montant restant affiché. */
export function ReconcileModal({ invoice, onClose }: { invoice: Commitment | null; onClose: () => void }) {
  const { message } = App.useApp();
  const transactions = useStore((s) => s.transactions);
  const reconciliations = useStore((s) => s.reconciliations);
  const commitments = useStore((s) => s.commitments);
  const reconcile = useStore((s) => s.reconcile);
  const unreconcile = useStore((s) => s.unreconcile);
  const [query, setQuery] = useState('');
  const [amounts, setAmounts] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const live = invoice ? (commitments.find((c) => c.id === invoice.id) ?? invoice) : null;

  useEffect(() => {
    setQuery('');
    setAmounts({});
  }, [invoice?.id]);

  const linked = useMemo(
    () => (live ? reconciliations.filter((r) => r.commitmentId === live.id).map((r) => ({ r, t: transactions.find((t) => t.id === r.transactionId) })) : []),
    [live, reconciliations, transactions],
  );

  const candidates = useMemo(() => {
    if (!live) return [];
    const q = query.trim().toLowerCase();
    const linkedIds = new Set(linked.map((l) => l.r.transactionId));
    return transactions
      .filter((t) => !t.isSplit && !t.hidden && (t.amount > 0) === (live.flow === 'in') && !linkedIds.has(t.id))
      .map((t) => {
        const available = Math.round((Math.abs(t.amount) - allocatedOf(t.id, reconciliations)) * 100) / 100;
        return { t, available, ...matchScore(t, live, available) };
      })
      .filter((x) => x.available > 0.005)
      .filter((x) => !q || `${x.t.rawLabel} ${x.t.label} ${x.t.counterparty ?? ''} ${Math.abs(x.t.amount)}`.toLowerCase().includes(q))
      .sort((a, b) => b.score - a.score || b.t.bookedAt.localeCompare(a.t.bookedAt))
      .slice(0, q ? 50 : 12);
  }, [live, transactions, reconciliations, query, linked]);

  if (!live) return null;
  const rest = remainingOf(live);

  const link = async (tId: string, available: number) => {
    setBusy(tId);
    try {
      await reconcile(tId, live.id, amounts[tId] ?? Math.min(available, rest));
      message.success('Paiement rapproché');
    } catch (e) {
      message.error(e instanceof ApiError ? e.message : 'Rapprochement impossible.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal open={invoice !== null} onCancel={onClose} footer={null} width={720} title={`Rapprocher · ${live.number ?? live.counterparty}`} destroyOnHidden>
      <p className="reco-head">
        <span>
          {live.counterparty} · échéance {formatDate(live.dueAt)}
        </span>
        <span>
          Montant <strong className="num">{formatEuro(live.amountInclTax)}</strong> · Reste à payer <strong className="num">{formatEuro(rest)}</strong>
        </span>
      </p>
      {linked.length > 0 && (
        <div className="reco-linked">
          <span className="eyebrow">Paiements rapprochés</span>
          {linked.map(({ r, t }) => (
            <div key={r.id} className="reco-line">
              <span className="muted">{t ? formatDate(t.bookedAt, false) : ''}</span>
              <span className="ellipsis">{t?.rawLabel ?? 'Opération supprimée'}</span>
              <span className="num">{formatEuro(r.amount)}</span>
              <Button size="small" onClick={() => void unreconcile(r.id).then(() => message.success('Rapprochement annulé'))}>
                Annuler le rapprochement
              </Button>
            </div>
          ))}
        </div>
      )}
      {rest > 0 && (
        <>
          <Input.Search placeholder="Rechercher une opération (libellé, montant)" allowClear value={query} onChange={(e) => setQuery(e.target.value)} className="reco-search" />
          {candidates.length === 0 ? (
            <Empty description="Aucune opération de même sens disponible." />
          ) : (
            <div className="reco-list">
              {candidates.map(({ t, available, score, reasons }) => (
                <div key={t.id} className="reco-line">
                  <span className="muted">{formatDate(t.bookedAt, false)}</span>
                  <span className="reco-label">
                    <span className="ellipsis">{t.rawLabel}</span>
                    <span className="reco-reasons">
                      {score >= 50 && <Tag color={score >= 80 ? 'green' : 'blue'}>{score} %</Tag>}
                      {reasons.join(' · ')}
                    </span>
                  </span>
                  <span className="num">
                    {formatEuro(Math.abs(t.amount))}
                    {available < Math.abs(t.amount) && <span className="muted reco-avail">dont {formatEuro(available)} disponibles</span>}
                  </span>
                  <InputNumber
                    size="small"
                    min={0.01}
                    max={Math.min(available, rest)}
                    value={amounts[t.id] ?? Math.min(available, rest)}
                    onChange={(v) => setAmounts((a) => ({ ...a, [t.id]: v ?? 0 }))}
                    decimalSeparator=","
                    aria-label="Montant affecté"
                    style={{ width: 110 }}
                  />
                  <Button size="small" type={score >= 80 ? 'primary' : 'default'} loading={busy === t.id} onClick={() => link(t.id, available)}>
                    Rapprocher
                  </Button>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </Modal>
  );
}

/** « Marquer comme payée » : date et compte du paiement. */
export function PayModal({ invoice, onClose }: { invoice: Commitment | null; onClose: () => void }) {
  const { message } = App.useApp();
  const accounts = useStore((s) => s.accounts);
  const today = useStore((s) => s.today);
  const update = useStore((s) => s.updateCommitment);
  const [date, setDate] = useState<Dayjs>(dayjs(today));
  const [accountId, setAccountId] = useState<string | null>(null);
  useEffect(() => {
    setDate(dayjs(today));
    setAccountId(invoice?.accountId ?? null);
  }, [invoice, today]);
  return (
    <Modal
      open={invoice !== null}
      onCancel={onClose}
      title="Marquer comme payée"
      okText="Marquer payée"
      cancelText="Annuler"
      destroyOnHidden
      onOk={async () => {
        if (!invoice) return;
        try {
          await update(invoice.id, { status: 'paid', paidAt: iso(date), ...(accountId ? { accountId } : {}) });
          message.success('Facture marquée payée');
          onClose();
        } catch (e) {
          message.error(e instanceof ApiError ? e.message : 'Action impossible.');
        }
      }}
    >
      <p className="muted">Sans opération bancaire associée. Pour relier le paiement à votre relevé, utilisez plutôt « Rapprocher d’un paiement ».</p>
      <div className="form-row">
        <label className="field">
          <span>Date du paiement</span>
          <DatePicker value={date} onChange={(d) => d && setDate(d)} format="DD/MM/YYYY" allowClear={false} />
        </label>
        <label className="field">
          <span>Compte</span>
          <Select allowClear placeholder="Compte de la facture" value={accountId ?? undefined} onChange={(v) => setAccountId(v ?? null)} options={accounts.map((a) => ({ value: a.id, label: accountLabel(a) }))} style={{ minWidth: 200 }} />
        </label>
      </div>
    </Modal>
  );
}

/** « Décaler l'échéance ». */
export function ShiftModal({ invoice, onClose }: { invoice: Commitment | null; onClose: () => void }) {
  const { message } = App.useApp();
  const update = useStore((s) => s.updateCommitment);
  const [date, setDate] = useState<Dayjs | null>(null);
  const [scope, setScope] = useState<SeriesScope>('one');
  useEffect(() => {
    setDate(invoice ? dayjs(invoice.dueAt).add(15, 'day') : null);
    setScope('one');
  }, [invoice]);
  return (
    <Modal
      open={invoice !== null}
      onCancel={onClose}
      title="Décaler l’échéance"
      okText="Enregistrer la nouvelle échéance"
      cancelText="Annuler"
      destroyOnHidden
      onOk={async () => {
        if (!invoice || !date) return;
        try {
          const res = await update(invoice.id, { dueAt: iso(date), paymentTerms: 'custom' }, scope);
          message.success(res.length > 1 ? `${res.length} échéances décalées` : `Échéance déplacée au ${formatDate(iso(date))}`);
          onClose();
        } catch (e) {
          message.error(e instanceof ApiError ? e.message : 'Action impossible.');
        }
      }}
    >
      {invoice && <p className="muted">Échéance actuelle : {formatDate(invoice.dueAt)}</p>}
      <div className="shift-quick">
        {[7, 15, 30].map((n) => (
          <Button key={n} size="small" onClick={() => invoice && setDate(dayjs(invoice.dueAt).add(n, 'day'))}>
            +{n} jours
          </Button>
        ))}
      </div>
      <DatePicker value={date} onChange={setDate} format="DD/MM/YYYY" allowClear={false} />
      {invoice?.seriesId && (
        <Radio.Group value={scope} onChange={(e) => setScope(e.target.value)} className="scope-choice">
          <Radio value="one">Cette échéance seulement</Radio>
          <Radio value="following">Cette échéance et les suivantes</Radio>
        </Radio.Group>
      )}
    </Modal>
  );
}

/** « Relancer le client » : email modifiable, envoyé au nom de l'utilisateur (réponse à son adresse). */
export function ReminderModal({ invoice, onClose }: { invoice: Commitment | null; onClose: () => void }) {
  const { message } = App.useApp();
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  useEffect(() => {
    if (!invoice) return;
    setTo('');
    void api<{ subject: string; body: string }>('GET', `/commitments/${encodeURIComponent(invoice.id)}/reminder`)
      .then((d) => {
        setSubject(d.subject);
        setBody(d.body);
      })
      .catch(() => message.error('Le modèle de relance n’a pas pu être préparé.'));
  }, [invoice, message]);
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to.trim());
  return (
    <Modal
      open={invoice !== null}
      onCancel={onClose}
      width={620}
      title={`Relancer ${invoice?.counterparty ?? ''}`}
      okText="Envoyer la relance"
      cancelText="Annuler"
      okButtonProps={{ disabled: !valid || !subject.trim() || !body.trim(), loading: sending }}
      destroyOnHidden
      onOk={async () => {
        if (!invoice) return;
        setSending(true);
        try {
          const r = await api<{ message: string }>('POST', `/commitments/${encodeURIComponent(invoice.id)}/reminder`, { to: to.trim(), subject, body });
          message.success(r.message);
          onClose();
        } catch (e) {
          message.error(e instanceof ApiError ? e.message : 'La relance n’a pas pu être envoyée.');
        } finally {
          setSending(false);
        }
      }}
    >
      <div className="reminder-form">
        <label className="field">
          <span>Destinataire</span>
          <Input type="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder="compta@client.fr" autoFocus status={to && !valid ? 'error' : undefined} />
        </label>
        <label className="field">
          <span>Objet</span>
          <Input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={200} />
        </label>
        <label className="field">
          <span>Message</span>
          <Input.TextArea value={body} onChange={(e) => setBody(e.target.value)} autoSize={{ minRows: 8, maxRows: 16 }} maxLength={5000} />
        </label>
        <p className="muted">Les réponses du client arriveront sur votre adresse email.</p>
      </div>
    </Modal>
  );
}
