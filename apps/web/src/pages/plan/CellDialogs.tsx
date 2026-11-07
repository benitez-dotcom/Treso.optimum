/** Fenêtres du menu de cellule : Répéter…, Augmenter de x %…, Commentaire. */
import { useEffect, useState } from 'react';
import { Button, Input, InputNumber, Modal, Space } from 'antd';
import { formatEuroRounded, formatMonthShort, monthDiff, repeatMonths, type MonthKey } from '@optimum/treso-engine';

interface RepeatProps {
  open: boolean;
  categoryName: string;
  month: MonthKey;
  amount: number;
  lastMonth: MonthKey;
  onCancel: () => void;
  onConfirm: (every: number, duration: number) => void;
}

export function RepeatModal({ open, categoryName, month, amount, lastMonth, onCancel, onConfirm }: RepeatProps) {
  const [every, setEvery] = useState(1);
  const [duration, setDuration] = useState(12);
  useEffect(() => {
    if (open) {
      setEvery(1);
      setDuration(12);
    }
  }, [open]);
  const endOfYear = 12 - Number(month.slice(5, 7)) + 1;
  const endOfPeriod = Math.max(1, Math.min(36, monthDiff(month, lastMonth) + 1));
  const valid = every >= 1 && every <= 12 && duration >= 1 && duration <= 36;
  const targets = valid ? repeatMonths(month, every, duration) : [];
  return (
    <Modal
      open={open}
      title={`Répéter ${formatEuroRounded(amount)} · ${categoryName}`}
      okText={`Répéter sur ${targets.length} mois`}
      cancelText="Annuler"
      okButtonProps={{ disabled: !valid }}
      onCancel={onCancel}
      onOk={() => onConfirm(every, duration)}
      destroyOnHidden
    >
      <div className="repeat-form">
        <label>
          Tous les
          <InputNumber min={1} max={12} value={every} onChange={(v) => setEvery(v ?? 1)} aria-label="Fréquence en mois" />
          mois
        </label>
        <label>
          pendant
          <InputNumber min={1} max={36} value={duration} onChange={(v) => setDuration(v ?? 1)} aria-label="Durée en mois" />
          mois, à partir de {formatMonthShort(month)}
        </label>
      </div>
      <Space wrap className="repeat-shortcuts">
        <Button size="small" onClick={() => { setEvery(1); setDuration(endOfYear); }}>Jusqu’à la fin de l’année</Button>
        <Button size="small" onClick={() => { setEvery(1); setDuration(12); }}>Sur 12 mois</Button>
        <Button size="small" onClick={() => { setEvery(1); setDuration(endOfPeriod); }}>Jusqu’à la fin de la période</Button>
        <Button size="small" onClick={() => { setEvery(3); setDuration(12); }}>Chaque trimestre</Button>
      </Space>
      <p className="muted repeat-preview">
        {targets.length > 0 ? `Mois concernés : ${targets.map(formatMonthShort).join(', ')}. Les valeurs existantes sont remplacées.` : 'Fréquence de 1 à 12 mois, durée de 1 à 36 mois.'}
      </p>
    </Modal>
  );
}

interface IncreaseProps {
  open: boolean;
  categoryName: string;
  month: MonthKey;
  lastMonth: MonthKey;
  onCancel: () => void;
  onConfirm: (percent: number) => void;
}

export function IncreaseModal({ open, categoryName, month, lastMonth, onCancel, onConfirm }: IncreaseProps) {
  const [percent, setPercent] = useState<number | null>(5);
  useEffect(() => {
    if (open) setPercent(5);
  }, [open]);
  return (
    <Modal
      open={open}
      title={`Augmenter · ${categoryName}`}
      okText="Appliquer"
      cancelText="Annuler"
      okButtonProps={{ disabled: percent === null || percent <= -100 }}
      onCancel={onCancel}
      onOk={() => percent !== null && onConfirm(percent)}
      destroyOnHidden
    >
      <label className="repeat-form">
        Augmenter de
        <InputNumber value={percent} onChange={setPercent} min={-99} max={1000} step={1} decimalSeparator="," addonAfter="%" aria-label="Pourcentage" />
      </label>
      <p className="muted">
        Chaque mois de {formatMonthShort(month)} à {formatMonthShort(lastMonth)} reçoit sa valeur actuelle majorée de ce pourcentage. Saisissez un nombre négatif pour une baisse.
      </p>
    </Modal>
  );
}

interface NoteProps {
  open: boolean;
  title: string;
  initial: string;
  readOnly: boolean;
  onCancel: () => void;
  onSave: (note: string | null) => void;
}

export function NoteModal({ open, title, initial, readOnly, onCancel, onSave }: NoteProps) {
  const [text, setText] = useState(initial);
  useEffect(() => {
    if (open) setText(initial);
  }, [open, initial]);
  return (
    <Modal
      open={open}
      title={title}
      onCancel={onCancel}
      destroyOnHidden
      footer={
        readOnly
          ? [<Button key="close" onClick={onCancel}>Fermer</Button>]
          : [
              initial && (
                <Button key="del" danger onClick={() => onSave(null)}>
                  Supprimer
                </Button>
              ),
              <Button key="cancel" onClick={onCancel}>Annuler</Button>,
              <Button key="ok" type="primary" disabled={!text.trim()} onClick={() => onSave(text)}>
                Enregistrer
              </Button>,
            ]
      }
    >
      <Input.TextArea
        autoFocus
        value={text}
        readOnly={readOnly}
        onChange={(e) => setText(e.target.value)}
        maxLength={1000}
        showCount
        autoSize={{ minRows: 3, maxRows: 8 }}
        placeholder="Ex. : Salon professionnel en mars, +30 % de ventes attendues."
        aria-label="Commentaire"
      />
    </Modal>
  );
}
