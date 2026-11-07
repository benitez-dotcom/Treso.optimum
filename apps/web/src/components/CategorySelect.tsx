import { useMemo } from 'react';
import { Select } from 'antd';
import type { Flow } from '@optimum/treso-engine';
import { flattenTree } from '../store/selectors';
import { useStore } from '../store/useStore';

interface Props {
  /** Sens de l'opération : ses catégories d'abord, l'autre sens ensuite (remboursement, avoir). */
  flow: Flow;
  value: string | null | undefined;
  onChange: (categoryId: string | null) => void;
  /** Catégorie suggérée, affichée en italique tant qu'elle n'est pas validée. */
  suggestionId?: string | null;
  disabled?: boolean;
  allowClear?: boolean;
  size?: 'small' | 'middle';
  ariaLabel: string;
  placeholder?: string;
  style?: React.CSSProperties;
  autoFocus?: boolean;
  /** Opération exclue des totaux : pas de mise en avant « à catégoriser ». */
  quiet?: boolean;
}

const RECENT_KEY = 'treso-recent-categories';

function recentIds(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as string[];
  } catch {
    return [];
  }
}

/** Mémorise les catégories utilisées récemment (affichées en tête). */
export function rememberCategory(id: string) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([id, ...recentIds().filter((x) => x !== id)].slice(0, 5)));
  } catch {
    /* stockage indisponible : sans conséquence */
  }
}

/** Recherche floue : chaque mot tapé doit apparaître, accents et casse ignorés. */
const fold = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
const fuzzy = (input: string, label: string) => fold(input).split(/\s+/).filter(Boolean).every((w) => fold(label).includes(w));

/** Sélecteur de catégorie (écran 7.6) : sens de l'opération d'abord, récentes en tête, recherche floue. */
export function CategorySelect({ flow, value, onChange, suggestionId, disabled, allowClear = true, size = 'middle', ariaLabel, placeholder = 'À catégoriser', style, autoFocus, quiet }: Props) {
  const categories = useStore((s) => s.categories);
  const options = useMemo(() => {
    const byId = new Map(categories.map((c) => [c.id, c]));
    const toOption = (id: string, depth = 0) => {
      const c = byId.get(id)!;
      return { value: c.id, label: c.name, searchLabel: c.name, depthLabel: `${' '.repeat(depth)}${c.name}` };
    };
    const own = flattenTree(categories, flow).map((r) => toOption(r.category.id, r.depth));
    const other = flattenTree(categories, flow === 'in' ? 'out' : 'in').map((r) => toOption(r.category.id, r.depth));
    const recent = recentIds().filter((id) => byId.get(id)?.flow === flow).map((id) => ({ ...toOption(id), value: id }));
    const groups = [];
    if (recent.length) groups.push({ label: 'Récentes', title: 'Récentes', options: recent.map((o) => ({ ...o, value: `recent:${o.value}` })) });
    groups.push({ label: flow === 'in' ? 'Encaissements' : 'Décaissements', title: 'Sens', options: own });
    groups.push({ label: 'Autre sens (remboursement, avoir…)', title: 'Autre sens', options: other });
    return groups;
  }, [categories, flow]);

  const isSuggestion = !value && suggestionId;
  const current = value ?? suggestionId ?? undefined;
  return (
    <Select
      showSearch
      size={size}
      allowClear={allowClear && Boolean(value)}
      disabled={disabled}
      autoFocus={autoFocus}
      value={current}
      placeholder={quiet && !current ? '—' : placeholder}
      aria-label={ariaLabel}
      className={`category-select${isSuggestion ? ' is-suggestion' : ''}${!current && !quiet ? ' is-empty' : ''}`}
      style={{ minWidth: 200, ...style }}
      popupMatchSelectWidth={300}
      options={options}
      optionLabelProp="label"
      optionRender={(o) => <span style={{ whiteSpace: 'pre' }}>{(o.data as { depthLabel?: string }).depthLabel ?? o.label}</span>}
      filterOption={(input, option) => Boolean(option && 'searchLabel' in option && fuzzy(input, String(option.searchLabel)))}
      notFoundContent="Aucune catégorie ne correspond."
      onChange={(v: string | undefined) => {
        const id = v ? v.replace(/^recent:/, '') : null;
        if (id) rememberCategory(id);
        onChange(id);
      }}
      onClick={(e) => e.stopPropagation()}
    />
  );
}
