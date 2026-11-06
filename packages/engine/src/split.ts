/** Division d'une opération (écran 7.6). */

/**
 * Répartit `amount` en `parts` lignes : chaque ligne vaut le quotient arrondi
 * à l'euro supérieur, la dernière absorbe le reste.
 * Exemple normatif : 258,20 en 2 → 130,00 + 128,20.
 */
export function splitEqually(amount: number, parts: number): number[] {
  if (!Number.isInteger(parts) || parts < 2) throw new RangeError('Il faut au moins 2 parts.');
  const sign = amount < 0 ? -1 : 1;
  const totalCents = Math.round(Math.abs(amount) * 100);
  const shareCents = Math.ceil(totalCents / parts / 100) * 100;
  const result: number[] = [];
  let remaining = totalCents;
  for (let i = 0; i < parts - 1; i++) {
    const s = Math.min(shareCents, remaining);
    result.push((sign * s) / 100);
    remaining -= s;
  }
  result.push((sign * remaining) / 100);
  return result;
}

/** Reste à répartir (doit valoir 0 pour valider la division). */
export function remainingToSplit(amount: number, lines: number[]): number {
  const cents = Math.round(amount * 100) - lines.reduce((s, l) => s + Math.round(l * 100), 0);
  return cents / 100;
}
