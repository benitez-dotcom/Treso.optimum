/** Période affichée (préréglages, personnalisée) et cumul de la colonne Total. */
import { useEffect, useState } from 'react';
import { DatePicker, Modal, Select } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { validatePeriod, type MonthKey, type Period, type PeriodPreset } from '@optimum/treso-engine';

const toMonth = (d: Dayjs): MonthKey => d.startOf('month').format('YYYY-MM-01');

interface PeriodProps {
  preset: PeriodPreset;
  period: Period;
  onChange: (preset: PeriodPreset, custom?: Period) => void;
}

export function PeriodSelect({ preset, period, onChange }: PeriodProps) {
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="period-select">
      <Select<PeriodPreset>
        value={preset}
        onChange={(v) => {
          setError(null);
          onChange(v, v === 'custom' ? period : undefined);
        }}
        aria-label="Période affichée"
        style={{ width: 180 }}
        options={[
          { value: 'rolling', label: '12 mois glissants' },
          { value: 'calendar', label: 'Année civile' },
          { value: 'fiscal', label: 'Exercice' },
          { value: 'custom', label: 'Personnalisée' },
        ]}
      />
      {preset === 'custom' && (
        <DatePicker.RangePicker
          picker="month"
          format="MMM YYYY"
          allowClear={false}
          value={[dayjs(period.from), dayjs(period.to)]}
          status={error ? 'error' : undefined}
          aria-label="Mois de début et de fin"
          onChange={(v) => {
            if (!v?.[0] || !v[1]) return;
            const p = { from: toMonth(v[0]), to: toMonth(v[1]) };
            const err = validatePeriod(p);
            setError(err);
            if (!err) onChange('custom', p);
          }}
        />
      )}
      {error && (
        <span className="field-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

interface CumulProps {
  open: boolean;
  value: Period;
  displayed: Period;
  onCancel: () => void;
  onApply: (p: Period | null) => void;
}

/** « Personnaliser le cumul » : mois de début et de fin de la colonne Total (24 mois maximum). */
export function CumulModal({ open, value, displayed, onCancel, onApply }: CumulProps) {
  const [range, setRange] = useState<Period>(value);
  useEffect(() => {
    if (open) setRange(value);
  }, [open, value]);
  const error = validatePeriod(range);
  return (
    <Modal
      open={open}
      title="Personnaliser le cumul"
      okText="Appliquer"
      cancelText="Annuler"
      onCancel={onCancel}
      okButtonProps={{ disabled: !!error }}
      onOk={() => onApply(range.from === displayed.from && range.to === displayed.to ? null : range)}
      destroyOnHidden
    >
      <p className="muted">La colonne Total additionne les mois choisis : réalisé pour les mois passés, prévu ensuite.</p>
      <DatePicker.RangePicker
        picker="month"
        format="MMM YYYY"
        allowClear={false}
        value={[dayjs(range.from), dayjs(range.to)]}
        status={error ? 'error' : undefined}
        onChange={(v) => v?.[0] && v[1] && setRange({ from: toMonth(v[0]), to: toMonth(v[1]) })}
      />
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      <p>
        <button type="button" className="link-btn" onClick={() => setRange(displayed)}>
          Revenir à la période affichée
        </button>
      </p>
    </Modal>
  );
}
