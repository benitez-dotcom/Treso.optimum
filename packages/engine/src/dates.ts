import type { IsoDate, MonthKey } from './types';

/** Mois (`yyyy-MM-01`) contenant une date ISO. */
export function monthOf(date: IsoDate): MonthKey {
  return `${date.slice(0, 7)}-01`;
}

/** Décale un mois de `n` mois (n peut être négatif). */
export function addMonths(month: MonthKey, n: number): MonthKey {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7)) - 1 + n;
  const year = y + Math.floor(m / 12);
  const mon = ((m % 12) + 12) % 12;
  return `${year}-${String(mon + 1).padStart(2, '0')}-01`;
}

/** Liste de `count` mois consécutifs à partir de `from`. */
export function monthRange(from: MonthKey, count: number): MonthKey[] {
  return Array.from({ length: count }, (_, i) => addMonths(from, i));
}

/** Nombre de mois entre deux mois (b − a). */
export function monthDiff(a: MonthKey, b: MonthKey): number {
  const ya = Number(a.slice(0, 4));
  const ma = Number(a.slice(5, 7));
  const yb = Number(b.slice(0, 4));
  const mb = Number(b.slice(5, 7));
  return (yb - ya) * 12 + (mb - ma);
}

/** Date du jour en Europe/Paris, format ISO. */
export function todayInParis(now: Date = new Date()): IsoDate {
  const parts = new Intl.DateTimeFormat('fr-CA', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  return parts;
}

export function addDays(date: IsoDate, n: number): IsoDate {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(a: IsoDate, b: IsoDate): number {
  const da = Date.parse(`${a}T12:00:00Z`);
  const db = Date.parse(`${b}T12:00:00Z`);
  return Math.round((db - da) / 86_400_000);
}
