/** Formats d'affichage français (conventions, section 0). */
import type { IsoDate, MonthKey } from './types';

const eur = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const eur0 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });

/** `1 234,56 €` */
export const formatEuro = (n: number): string => eur.format(n);

/** `1 234 €` — arrondi à l'euro inférieur. */
export const formatEuroRounded = (n: number): string => `${eur0.format(Math.floor(n))} €`;

/** Montant du plan : arrondi à l'euro inférieur, « — » pour zéro. */
export function formatPlanAmount(n: number): string {
  const v = Math.floor(n + 1e-9);
  return v === 0 ? '—' : eur0.format(v);
}

/** Variation signée : `+6 517`, `−2 600`. */
export function formatSigned(n: number): string {
  const v = Math.floor(n + 1e-9);
  if (v === 0) return '—';
  return v > 0 ? `+${eur0.format(v)}` : `−${eur0.format(-v)}`;
}

const monthShort = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const monthLong = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

/** `nov. 26` */
export function formatMonthShort(m: MonthKey): string {
  return `${monthShort[Number(m.slice(5, 7)) - 1]} ${m.slice(2, 4)}`;
}

/** `novembre` */
export function formatMonthName(m: MonthKey): string {
  return monthLong[Number(m.slice(5, 7)) - 1]!;
}

/** `5 nov. 2026` */
export function formatDate(d: IsoDate, withYear = true): string {
  const day = Number(d.slice(8, 10));
  const mon = monthShort[Number(d.slice(5, 7)) - 1];
  return withYear ? `${day} ${mon} ${d.slice(0, 4)}` : `${day} ${mon}`;
}

/** `26,96 %` */
export const formatPercent = (n: number, digits = 1): string =>
  `${n.toLocaleString('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits })} %`;
