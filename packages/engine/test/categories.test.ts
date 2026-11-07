import { describe, expect, it } from 'vitest';
import { CATEGORY_TEMPLATES, moveBudgetChanges, moveConsequence, moveError, nameTaken, reorderSiblings, subtreeIds, templateAdditions, transferBudgets, type Budget } from '../src';
import { cat } from './fixtures';

const categories = [
  cat('ventes', 'in', null, { name: 'Ventes' }),
  cat('fg', 'out', null, { name: 'Frais généraux', budgetAtParent: true, position: 1 }),
  cat('loyer', 'out', null, { name: 'Loyer', position: 2 }),
  cat('rh', 'out', null, { name: 'Personnel', position: 3 }),
  cat('salaires', 'out', 'rh', { name: 'Salaires' }),
  cat('tva', 'out', null, { name: 'TVA', isVat: true, position: 4 }),
];
const budgets: Budget[] = [
  { scenarioId: 'base', categoryId: 'loyer', month: '2027-01-01', amount: 1000 },
  { scenarioId: 'base', categoryId: 'loyer', month: '2027-02-01', amount: 1000 },
  { scenarioId: 'base', categoryId: 'fg', month: '2027-01-01', amount: 500 },
  { scenarioId: 'base', categoryId: 'ventes', month: '2027-01-01', amount: 9000 },
];

describe('7.9 — déplacer une catégorie', () => {
  it('interdit les cycles, le changement de sens et la TVA comme parent', () => {
    expect(moveError(categories, 'rh', 'salaires')).toBe('Une catégorie ne peut pas être rangée dans l’une de ses sous-catégories.');
    expect(moveError(categories, 'loyer', 'ventes')).toBe('Une catégorie reste dans son sens (encaissement ou décaissement).');
    expect(moveError(categories, 'loyer', 'tva')).toBe('La catégorie de la TVA ne peut pas avoir de sous-catégorie.');
    expect(moveError(categories, 'loyer', 'rh')).toBeNull();
    expect(subtreeIds(categories, 'rh')).toEqual(['rh', 'salaires']);
  });

  it('vers un parent budgété globalement : budgets regroupés', () => {
    const c = moveConsequence(categories, budgets, 'loyer', 'fg');
    expect(c).toEqual({ kind: 'mergeIntoParent', months: 2, message: 'Les budgets de Loyer (2 mois) seront regroupés dans Frais généraux, budgétée globalement.' });
    expect(moveBudgetChanges(categories, budgets, 'loyer', 'fg', 'sum')).toEqual([
      { scenarioId: 'base', categoryId: 'loyer', month: '2027-01-01', amount: null },
      { scenarioId: 'base', categoryId: 'loyer', month: '2027-02-01', amount: null },
      { scenarioId: 'base', categoryId: 'fg', month: '2027-01-01', amount: 1500 },
      { scenarioId: 'base', categoryId: 'fg', month: '2027-02-01', amount: 1000 },
    ]);
    expect(moveBudgetChanges(categories, budgets, 'loyer', 'fg', 'delete').every((b) => b.amount === null)).toBe(true);
  });

  it('sous une feuille budgétée : ses budgets passent à la sous-catégorie', () => {
    const c = moveConsequence(categories, budgets, 'rh', 'loyer');
    expect(c.kind).toBe('parentLoses');
    expect(moveBudgetChanges(categories, budgets, 'rh', 'loyer', 'sum').filter((b) => b.amount !== null)).toEqual([
      { scenarioId: 'base', categoryId: 'rh', month: '2027-01-01', amount: 1000 },
      { scenarioId: 'base', categoryId: 'rh', month: '2027-02-01', amount: 1000 },
    ]);
    expect(moveConsequence(categories, budgets, 'loyer', 'rh')).toEqual({ kind: 'none' });
  });

  it('réordonne les frères', () => {
    expect(reorderSiblings(categories, 'tva', null, 0).map((r) => r.id)).toEqual(['tva', 'fg', 'loyer', 'rh']);
  });

  it('fusion : budgets additionnés', () => {
    expect(transferBudgets(budgets, ['loyer'], 'fg').filter((b) => b.amount !== null)).toEqual([
      { scenarioId: 'base', categoryId: 'fg', month: '2027-01-01', amount: 1500 },
      { scenarioId: 'base', categoryId: 'fg', month: '2027-02-01', amount: 1000 },
    ]);
  });
});

describe('modèles sectoriels', () => {
  it('ajoute seulement les catégories manquantes, parents d’abord', () => {
    const add = templateAdditions(categories, CATEGORY_TEMPLATES.find((t) => t.key === 'services')!.categories);
    const names = add.map((a) => a.name);
    expect(names).not.toContain('Frais généraux');
    expect(names).not.toContain('Loyer');
    expect(names).not.toContain('TVA');
    expect(names).toContain('Prestations');
    expect(names.indexOf('Salaires et charges')).toBeLessThan(names.indexOf('URSSAF'));
    expect(templateAdditions([...categories, ...add.map((a, i) => cat(`n${i}`, a.flow, null, { name: a.name }))], CATEGORY_TEMPLATES[1]!.categories)).toEqual([]);
  });

  it('nom unique entre catégories sœurs', () => {
    expect(nameTaken(categories, ' loyer ', 'out', null)).toBe(true);
    expect(nameTaken(categories, 'Loyer', 'out', 'rh')).toBe(false);
    expect(nameTaken(categories, 'Loyer', 'out', null, 'loyer')).toBe(false);
  });
});
