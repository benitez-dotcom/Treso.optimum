/**
 * Éditeur d'indicateur (écran 7.13) : formule avec autocomplétion des
 * catégories, coloration, validation en direct et aperçu sur 6 mois.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { App, Button, Form, Input, Modal, Select } from 'antd';
import {
  FormulaError,
  INDICATOR_LINES,
  formatMonthShort,
  indicatorResolver,
  indicatorValue,
  parseFormula,
  type IndicatorFormat,
  type PlanResult,
} from '@optimum/treso-engine';
import { useStore } from '../../store/useStore';
import type { Indicator } from '../../api/types';
import { formatIndicatorValue } from '../plan/format';

export interface IndicatorDraft {
  name: string;
  formula: string;
  unit: string;
  format: IndicatorFormat;
  decimals: number;
}

interface Props {
  open: boolean;
  /** Indicateur modifié, ou brouillon (modèle) pour une création. */
  indicator: Indicator | null;
  draft: IndicatorDraft | null;
  plan: PlanResult;
  previewMonths: string[];
  onClose: () => void;
}

const norm = (s: string) => s.toLocaleLowerCase('fr').normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Formule colorée : catégories en puces pétrole, opérateurs accentués. */
export function FormulaView({ formula }: { formula: string }) {
  const parts = formula.split(/(\[[^\]]*\]|[+\-*/×÷()])/).filter((p) => p.trim() !== '');
  return (
    <span className="formula-view">
      {parts.map((p, i) =>
        p.startsWith('[') ? (
          <span key={i} className="formula-ref">
            {p.slice(1, -1)}
          </span>
        ) : /^[+\-*/×÷]$/.test(p) ? (
          <span key={i} className="formula-op">
            {{ '*': '×', '/': '÷', '-': '−' }[p] ?? p}
          </span>
        ) : /^[()]$/.test(p) ? (
          <span key={i} className="formula-paren">
            {p}
          </span>
        ) : (
          <span key={i} className="formula-num">
            {p.trim()}
          </span>
        ),
      )}
    </span>
  );
}

export function IndicatorEditor({ open, indicator, draft, plan, previewMonths, onClose }: Props) {
  const { message } = App.useApp();
  const categories = useStore((s) => s.categories);
  const indicators = useStore((s) => s.indicators);
  const createIndicator = useStore((s) => s.createIndicator);
  const updateIndicator = useStore((s) => s.updateIndicator);
  const [form] = Form.useForm<IndicatorDraft>();
  const [formula, setFormula] = useState('');
  const [caret, setCaret] = useState(0);
  const [pick, setPick] = useState(0);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const v: IndicatorDraft = indicator
      ? { name: indicator.name, formula: indicator.formula, unit: indicator.unit, format: indicator.format, decimals: indicator.decimals }
      : (draft ?? { name: '', formula: '', unit: '', format: 'number', decimals: 2 });
    form.setFieldsValue(v);
    setFormula(v.formula);
    setCaret(v.formula.length);
  }, [open, indicator, draft, form]);

  const names = useMemo(
    () => [...INDICATOR_LINES.map((l) => ({ name: l.name, kind: 'Ligne du plan' })), ...categories.map((c) => ({ name: c.name, kind: c.flow === 'in' ? 'Encaissement' : 'Décaissement' }))],
    [categories],
  );

  // Mot en cours de saisie : après « [ » ou lettres tapées
  const token = useMemo(() => {
    const before = formula.slice(0, caret);
    const open_ = before.lastIndexOf('[');
    if (open_ > before.lastIndexOf(']')) return { start: open_, query: before.slice(open_ + 1) };
    const m = /[A-Za-zÀ-ÿ'’][A-Za-zÀ-ÿ'’ ]*$/.exec(before);
    if (m && m[0].trim().length >= 2) return { start: m.index, query: m[0] };
    return null;
  }, [formula, caret]);

  const suggestions = useMemo(() => {
    if (!token) return [];
    const q = norm(token.query.trim());
    return names.filter((n) => norm(n.name).includes(q)).slice(0, 8);
  }, [token, names]);
  useEffect(() => setPick(0), [token?.query]);

  const insert = (name: string) => {
    if (!token) return;
    const next = `${formula.slice(0, token.start)}[${name}] ${formula.slice(caret).replace(/^[^[\]+\-*/×÷()]*\]/, '').trimStart()}`;
    const pos = token.start + name.length + 3;
    setFormula(next);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(pos, pos);
      setCaret(pos);
    });
  };

  const parsed = useMemo(() => {
    if (!formula.trim()) return { expr: null, error: null as string | null };
    try {
      return { expr: parseFormula(formula, indicatorResolver(categories)), error: null };
    } catch (e) {
      return { expr: null, error: e instanceof FormulaError ? e.message : 'Formule invalide.' };
    }
  }, [formula, categories]);

  const format = Form.useWatch('format', form) ?? 'number';
  const unit = Form.useWatch('unit', form) ?? '';
  const decimals = Form.useWatch('decimals', form) ?? 2;

  const submit = async (v: IndicatorDraft) => {
    if (parsed.error || !parsed.expr) return;
    setSaving(true);
    try {
      const body = { ...v, name: v.name.trim(), unit: (v.unit ?? '').trim(), formula: formula.trim() };
      if (indicator) await updateIndicator(indicator.id, body);
      else await createIndicator(body);
      message.success(indicator ? 'Indicateur modifié' : 'Indicateur créé : il apparaît aussi dans le plan de trésorerie.');
      onClose();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "L'indicateur n'a pas pu être enregistré.");
    } finally {
      setSaving(false);
    }
  };

  const showSuggest = suggestions.length > 0 && document.activeElement === inputRef.current;

  return (
    <Modal
      open={open}
      onCancel={onClose}
      width={720}
      title={indicator ? `Modifier « ${indicator.name} »` : 'Nouvel indicateur'}
      destroyOnHidden
      footer={[
        <Button key="c" onClick={onClose}>
          Annuler
        </Button>,
        <Button key="ok" type="primary" loading={saving} disabled={!!parsed.error || !parsed.expr} onClick={() => form.submit()}>
          {indicator ? 'Enregistrer' : 'Créer l’indicateur'}
        </Button>,
      ]}
    >
      <Form form={form} layout="vertical" onFinish={submit} requiredMark={false}>
        <Form.Item
          name="name"
          label="Nom"
          rules={[
            { required: true, whitespace: true, message: 'Donnez un nom à votre indicateur.' },
            {
              validator: (_, v: string) =>
                indicators.some((i) => i.id !== indicator?.id && i.name.trim().toLocaleLowerCase('fr') === (v ?? '').trim().toLocaleLowerCase('fr'))
                  ? Promise.reject(new Error('Un indicateur porte déjà ce nom.'))
                  : Promise.resolve(),
            },
          ]}
        >
          <Input maxLength={80} placeholder="Ex. : Marge brute" autoFocus />
        </Form.Item>

        <Form.Item
          label="Formule"
          validateStatus={parsed.error ? 'error' : undefined}
          help={parsed.error ?? 'Tapez le nom d’une catégorie (« Ven » propose « Ventes ») ou ouvrez un crochet [. Opérateurs : + − * / et parenthèses.'}
        >
          <div className="formula-field">
            <Input.TextArea
              ref={(r) => {
                inputRef.current = r?.resizableTextArea?.textArea ?? null;
              }}
              value={formula}
              autoSize={{ minRows: 2, maxRows: 4 }}
              spellCheck={false}
              placeholder="[Achats] / 1,2 / ([Ventes] / 1,1) * 100"
              aria-autocomplete="list"
              aria-expanded={showSuggest}
              onChange={(e) => {
                setFormula(e.target.value);
                setCaret(e.target.selectionStart ?? e.target.value.length);
              }}
              onSelect={(e) => setCaret((e.target as HTMLTextAreaElement).selectionStart ?? 0)}
              onKeyDown={(e) => {
                if (!showSuggest) return;
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setPick((p) => (p + 1) % suggestions.length);
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setPick((p) => (p - 1 + suggestions.length) % suggestions.length);
                } else if (e.key === 'Enter' || e.key === 'Tab') {
                  e.preventDefault();
                  insert(suggestions[pick]!.name);
                }
              }}
            />
            {showSuggest && (
              <ul className="formula-suggest" role="listbox">
                {suggestions.map((s, i) => (
                  <li
                    key={s.name}
                    role="option"
                    aria-selected={i === pick}
                    className={i === pick ? 'active' : undefined}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      insert(s.name);
                    }}
                  >
                    <span>{s.name}</span>
                    <span className="muted">{s.kind}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Form.Item>
        {formula.trim() && !parsed.error && (
          <p className="formula-preview">
            <FormulaView formula={formula} />
          </p>
        )}

        <div className="indicator-options">
          <Form.Item name="format" label="Format">
            <Select
              style={{ width: 160 }}
              options={[
                { value: 'number', label: 'Nombre' },
                { value: 'percent', label: 'Pourcentage' },
                { value: 'currency', label: 'Montant en €' },
              ]}
              onChange={(f: IndicatorFormat) => {
                if (f === 'percent' && !form.getFieldValue('unit')) form.setFieldValue('unit', '%');
                if (f === 'currency' && !form.getFieldValue('unit')) form.setFieldValue('unit', '€');
              }}
            />
          </Form.Item>
          <Form.Item name="unit" label="Unité" rules={[{ max: 3, message: 'L’unité tient en 3 caractères maximum.' }]}>
            <Input style={{ width: 90 }} maxLength={3} placeholder="%" />
          </Form.Item>
          <Form.Item name="decimals" label="Décimales">
            <Select style={{ width: 90 }} options={[0, 1, 2].map((d) => ({ value: d, label: String(d) }))} />
          </Form.Item>
        </div>
      </Form>

      <div className="indicator-preview">
        <span className="eyebrow">Aperçu · scénario de base</span>
        <table className="mini-table">
          <thead>
            <tr>
              {previewMonths.map((m) => (
                <th key={m}>{formatMonthShort(m)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              {previewMonths.map((m) => (
                <td key={m}>{formatIndicatorValue({ unit, format, decimals }, parsed.expr ? indicatorValue(parsed.expr, plan, plan.baseScenarioId, m) : null)}</td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </Modal>
  );
}
