import { useEffect, useMemo, useState } from 'react';
import { App, Button, InputNumber, Modal, Segmented } from 'antd';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { formatEuro, splitByPercentages, splitEqually, validateSplit, type Transaction } from '@optimum/treso-engine';
import { ApiError } from '../api/client';
import { useStore } from '../store/useStore';
import { CategorySelect } from './CategorySelect';

interface Line {
  key: number;
  categoryId: string | null;
  /** Montant absolu saisi (le sens est celui de l'opération). */
  amount: number | null;
  percent: number | null;
}

let seq = 0;
const newLine = (categoryId: string | null, amount: number | null, percent: number | null = null): Line => ({ key: ++seq, categoryId, amount, percent });

/** Division d'une opération (écran 7.6) : parts égales ou pourcentages, reste à répartir nul pour valider. */
export function SplitModal({ transaction, open, onClose }: { transaction: Transaction; open: boolean; onClose: () => void }) {
  const { message } = App.useApp();
  const split = useStore((s) => s.splitTransaction);
  const all = useStore((s) => s.transactions);
  const children = useMemo(() => all.filter((t) => t.parentId === transaction.id), [all, transaction.id]);
  const sign = transaction.amount < 0 ? -1 : 1;
  const total = Math.abs(transaction.amount);
  const flow = transaction.amount < 0 ? 'out' : 'in';
  const [mode, setMode] = useState<'amount' | 'percent'>('amount');
  const [parts, setParts] = useState(2);
  const [lines, setLines] = useState<Line[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (children.length) setLines(children.map((c) => newLine(c.categoryId, Math.abs(c.amount))));
    else {
      const [a, b] = splitEqually(total, 2);
      setLines([newLine(transaction.categoryId, a!), newLine(null, b!)]);
    }
    setMode('amount');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, transaction.id]);

  const amounts = useMemo(() => {
    if (mode === 'amount') return lines.map((l) => l.amount ?? 0);
    const pct = lines.map((l) => l.percent ?? 0);
    const sum = pct.reduce((s, p) => s + p, 0);
    if (Math.abs(sum - 100) > 0.001 || lines.length < 2) return lines.map((l) => Math.round(((total * (l.percent ?? 0)) / 100) * 100) / 100);
    return splitByPercentages(total, pct);
  }, [lines, mode, total]);

  const remaining = Math.round((total - amounts.reduce((s, a) => s + a, 0)) * 100) / 100;
  const error = validateSplit(transaction.amount, amounts.map((a) => sign * a));

  const equalize = () => {
    const n = Math.max(2, Math.min(20, parts));
    const values = splitEqually(total, n);
    setMode('amount');
    setLines(values.map((v, i) => newLine(lines[i]?.categoryId ?? null, v)));
  };

  const update = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const save = async () => {
    if (error) return;
    setSaving(true);
    try {
      await split(transaction.id, lines.map((l, i) => ({ amount: sign * amounts[i]!, categoryId: l.categoryId })));
      message.success(`Opération divisée en ${lines.length} lignes`);
      onClose();
    } catch (e) {
      message.error(e instanceof ApiError ? e.message : "La division n'a pas pu être enregistrée.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onCancel={onClose}
      title="Diviser l'opération"
      width={620}
      okText="Valider la division"
      cancelText="Annuler"
      okButtonProps={{ disabled: Boolean(error), loading: saving }}
      onOk={save}
      destroyOnHidden
    >
      <p className="muted" style={{ marginTop: 0 }}>
        {transaction.label} · <strong className="num">{formatEuro(transaction.amount)}</strong>
      </p>
      <div className="split-tools">
        <Segmented
          value={mode}
          onChange={(v) => {
            const m = v as 'amount' | 'percent';
            if (m === 'percent') setLines((ls) => ls.map((l, i) => ({ ...l, percent: Math.round(((amounts[i] ?? 0) / total) * 10000) / 100 })));
            setMode(m);
          }}
          options={[
            { value: 'amount', label: 'En montants' },
            { value: 'percent', label: 'En pourcentages' },
          ]}
        />
        <span className="split-equal">
          Répartir à parts égales en
          <InputNumber min={2} max={20} value={parts} onChange={(v) => setParts(v ?? 2)} style={{ width: 64 }} aria-label="Nombre de parts" />
          <Button onClick={equalize}>Répartir</Button>
        </span>
      </div>

      <div className="split-lines" role="table" aria-label="Lignes de la division">
        {lines.map((l, i) => (
          <div className="split-line" role="row" key={l.key}>
            <CategorySelect flow={flow} value={l.categoryId} onChange={(id) => update(l.key, { categoryId: id })} ariaLabel={`Catégorie de la ligne ${i + 1}`} style={{ flex: 1 }} />
            {mode === 'amount' ? (
              <InputNumber<number>
                min={0}
                step={10}
                precision={2}
                decimalSeparator=","
                value={l.amount}
                onChange={(v) => update(l.key, { amount: v })}
                addonAfter="€"
                style={{ width: 160 }}
                aria-label={`Montant de la ligne ${i + 1}`}
              />
            ) : (
              <span className="split-pct">
                <InputNumber<number> min={0} max={100} precision={2} decimalSeparator="," value={l.percent} onChange={(v) => update(l.key, { percent: v })} addonAfter="%" style={{ width: 130 }} aria-label={`Pourcentage de la ligne ${i + 1}`} />
                <span className="num muted">{formatEuro(amounts[i] ?? 0)}</span>
              </span>
            )}
            <Button type="text" icon={<DeleteOutlined />} aria-label={`Supprimer la ligne ${i + 1}`} disabled={lines.length <= 2} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} />
          </div>
        ))}
      </div>
      <Button type="dashed" icon={<PlusOutlined />} onClick={() => setLines((ls) => [...ls, newLine(null, remaining > 0 ? remaining : null, null)])}>
        Ajouter une ligne
      </Button>
      <p className={`split-remaining${remaining === 0 ? ' ok' : ''}`} role="status" aria-live="polite">
        Reste à répartir : <strong className="num">{formatEuro(remaining)}</strong>
        {error && remaining === 0 && <span className="muted"> · {error}</span>}
      </p>
    </Modal>
  );
}
