import { formatIndicator } from '@optimum/treso-engine';
import type { Indicator } from '../../api/types';

/** Valeur d'indicateur selon son format : « 26,96 % », « 1 250 € », « — ». */
export function formatIndicatorValue(ind: Pick<Indicator, 'unit' | 'format' | 'decimals'>, value: number | null): string {
  const unit = ind.unit || (ind.format === 'percent' ? '%' : ind.format === 'currency' ? '€' : '');
  return formatIndicator(value, unit, ind.format === 'currency' ? Math.min(ind.decimals, 0) : ind.decimals);
}

export const SCENARIO_COLORS = [
  { value: '#8A6FB0', label: 'Violet' },
  { value: '#C2410C', label: 'Orange' },
  { value: '#5B8C5A', label: 'Vert' },
  { value: '#84ADB7', label: 'Sauge' },
  { value: '#303031', label: 'Encre' },
  { value: '#B8860B', label: 'Ocre' },
];
