/** Estimation de la TVA (règle 5.8). À valider avec un expert-comptable. */
import { addMonths } from './dates';
import { round2 } from './plan';
import type { Category, MonthKey } from './types';

export type VatRegime = 'monthly' | 'quarterly';

/** TVA contenue dans un montant TTC. */
export const vatOf = (amountInclTax: number, rate: number): number => round2((amountInclTax * rate) / (100 + rate));

export interface VatScheduleLine {
  /** Mois de versement de la TVA. */
  month: MonthKey;
  /** Montant à verser (≥ 0). */
  due: number;
  /** Crédit de TVA reporté après ce versement. */
  creditAfter: number;
}

/**
 * Calcule les versements de TVA à partir de la prévision TTC par catégorie
 * et par mois (`forecastOf(catId, month)`), sur les mois `months`.
 * Mensuel : versement le mois suivant. Trimestriel : le mois suivant la fin du trimestre civil.
 * Un solde négatif devient un crédit reporté sur les périodes suivantes.
 */
export function computeVatSchedule(
  categories: Category[],
  months: MonthKey[],
  regime: VatRegime,
  forecastOf: (categoryId: string, month: MonthKey) => number,
): VatScheduleLine[] {
  const leaves = categories.filter((c) => !c.isVat && c.vatRate > 0 && !categories.some((k) => k.parentId === c.id));
  const netByMonth = new Map<MonthKey, number>();
  for (const m of months) {
    let net = 0;
    for (const c of leaves) {
      const v = vatOf(forecastOf(c.id, m), c.vatRate);
      net += c.flow === 'in' ? v : -v;
    }
    netByMonth.set(m, round2(net));
  }

  const periods = new Map<MonthKey, number>();
  for (const [m, net] of netByMonth) {
    let payMonth: MonthKey;
    if (regime === 'monthly') {
      payMonth = addMonths(m, 1);
    } else {
      const mon = Number(m.slice(5, 7));
      const quarterEnd = Math.ceil(mon / 3) * 3;
      payMonth = addMonths(m, quarterEnd - mon + 1);
    }
    periods.set(payMonth, round2((periods.get(payMonth) ?? 0) + net));
  }

  const out: VatScheduleLine[] = [];
  let credit = 0;
  for (const month of [...periods.keys()].sort()) {
    const net = round2(periods.get(month)! - credit);
    if (net >= 0) {
      out.push({ month, due: net, creditAfter: 0 });
      credit = 0;
    } else {
      credit = -net;
      out.push({ month, due: 0, creditAfter: credit });
    }
  }
  return out;
}
