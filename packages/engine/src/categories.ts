/**
 * Catégories (écran 7.9) : arborescence, déplacement (conséquences sur les
 * budgets), fusion, modèles sectoriels. Module pur.
 */
import type { Budget, Category, CategoryKind, Flow } from './types';

export const KIND_LABELS: Record<CategoryKind, string> = {
  revenue: 'Chiffre d’affaires',
  purchases: 'Achats',
  overheads: 'Frais généraux',
  payroll: 'Masse salariale',
  none: 'Aucun',
};

export const VAT_RATES = [0, 2.1, 5.5, 10, 20];

/** La catégorie et toutes ses descendantes. */
export function subtreeIds(categories: Category[], id: string): string[] {
  const out = [id];
  for (let i = 0; i < out.length; i++) for (const c of categories) if (c.parentId === out[i]) out.push(c.id);
  return out;
}

export const hasChildren = (categories: Category[], id: string) => categories.some((c) => c.parentId === id);

/** Un déplacement est-il possible ? Renvoie le message d'erreur ou `null`. */
export function moveError(categories: Category[], id: string, newParentId: string | null): string | null {
  const cat = categories.find((c) => c.id === id);
  if (!cat) return 'Catégorie introuvable.';
  if (newParentId === null) return null;
  const parent = categories.find((c) => c.id === newParentId);
  if (!parent) return 'Catégorie parente introuvable.';
  if (parent.flow !== cat.flow) return 'Une catégorie reste dans son sens (encaissement ou décaissement).';
  if (subtreeIds(categories, id).includes(newParentId)) return 'Une catégorie ne peut pas être rangée dans l’une de ses sous-catégories.';
  if (parent.isVat) return 'La catégorie de la TVA ne peut pas avoir de sous-catégorie.';
  return null;
}

export type MoveConsequence =
  | { kind: 'none' }
  /** La catégorie déplacée (et ses sous-catégories) rejoint un parent à budget global. */
  | { kind: 'mergeIntoParent'; months: number; message: string }
  /** Le nouveau parent était une feuille avec des budgets : ils ne seraient plus utilisés. */
  | { kind: 'parentLoses'; months: number; message: string };

const monthsOf = (budgets: Budget[], ids: string[]) => {
  const set = new Set(ids);
  return new Set(budgets.filter((b) => set.has(b.categoryId) && b.amount !== null).map((b) => `${b.scenarioId}|${b.month}`)).size;
};

const plural = (n: number, w: string) => `${n} ${w}${n > 1 ? 's' : ''}`;

/** Conséquences d'un déplacement sur les budgets, pour l'aperçu avant validation. */
export function moveConsequence(categories: Category[], budgets: Budget[], id: string, newParentId: string | null): MoveConsequence {
  if (!newParentId) return { kind: 'none' };
  const cat = categories.find((c) => c.id === id)!;
  const parent = categories.find((c) => c.id === newParentId)!;
  if (parent.budgetAtParent) {
    const months = monthsOf(budgets, subtreeIds(categories, id));
    if (months)
      return { kind: 'mergeIntoParent', months, message: `Les budgets de ${cat.name} (${months} mois) seront regroupés dans ${parent.name}, budgétée globalement.` };
  } else if (!hasChildren(categories, parent.id)) {
    const months = monthsOf(budgets, [parent.id]);
    if (months)
      return {
        kind: 'parentLoses',
        months,
        message: `${parent.name} devient une catégorie parente : ses budgets (${months} mois) se calculeront à partir des sous-catégories. Conservez-les en les ajoutant à ${cat.name}, ou supprimez-les.`,
      };
  }
  return { kind: 'none' };
}

/**
 * Budgets après un déplacement : `sum` additionne les budgets concernés dans
 * la catégorie qui les reprend, `delete` les supprime. Renvoie les changements
 * à appliquer (montant `null` = supprimer).
 */
export function moveBudgetChanges(categories: Category[], budgets: Budget[], id: string, newParentId: string, mode: 'sum' | 'delete'): Budget[] {
  const c = moveConsequence(categories, budgets, id, newParentId);
  if (c.kind === 'none') return [];
  const fromIds = c.kind === 'mergeIntoParent' ? subtreeIds(categories, id) : [newParentId];
  const to = c.kind === 'mergeIntoParent' ? newParentId : id;
  return transferBudgets(budgets, fromIds, mode === 'sum' ? to : null);
}

/** Supprime les budgets des catégories `fromIds` et, si `to`, les additionne dans `to`. */
export function transferBudgets(budgets: Budget[], fromIds: string[], to: string | null): Budget[] {
  const from = new Set(fromIds);
  const changes: Budget[] = [];
  const sums = new Map<string, number>();
  for (const b of budgets) {
    if (!from.has(b.categoryId) || b.categoryId === to) continue;
    changes.push({ ...b, amount: null });
    if (to && b.amount) sums.set(`${b.scenarioId}|${b.month}`, (sums.get(`${b.scenarioId}|${b.month}`) ?? 0) + b.amount);
  }
  if (to) {
    const existing = new Map(budgets.filter((b) => b.categoryId === to).map((b) => [`${b.scenarioId}|${b.month}`, b.amount ?? 0]));
    for (const [k, v] of sums) {
      const [scenarioId, month] = k.split('|') as [string, string];
      changes.push({ scenarioId, categoryId: to, month, amount: Math.round(((existing.get(k) ?? 0) + v) * 100) / 100 });
    }
  }
  return changes;
}

/** Positions des frères après insertion de `id` sous `parentId` à l'index `index`. */
export function reorderSiblings(categories: Category[], id: string, parentId: string | null, index: number): { id: string; parentId: string | null; position: number }[] {
  const cat = categories.find((c) => c.id === id)!;
  const siblings = categories
    .filter((c) => c.flow === cat.flow && c.parentId === parentId && c.id !== id)
    .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name, 'fr'));
  siblings.splice(Math.max(0, Math.min(index, siblings.length)), 0, cat);
  return siblings.map((c, i) => ({ id: c.id, parentId, position: i + 1 }));
}

// ───────────────────────── Modèles sectoriels ─────────────────────────

export interface TemplateCategory {
  name: string;
  flow: Flow;
  kind?: CategoryKind;
  vatRate?: number;
  parent?: string;
  isVat?: boolean;
}

const common: TemplateCategory[] = [
  { name: 'Autres encaissements', flow: 'in' },
  { name: 'Apports et financements', flow: 'in' },
  { name: 'Remboursement de TVA', flow: 'in' },
  { name: 'Salaires et charges', flow: 'out', kind: 'payroll' },
  { name: 'Salaires nets', flow: 'out', parent: 'Salaires et charges' },
  { name: 'URSSAF', flow: 'out', parent: 'Salaires et charges' },
  { name: 'Prélèvement à la source', flow: 'out', parent: 'Salaires et charges' },
  { name: 'Frais généraux', flow: 'out', kind: 'overheads' },
  { name: 'Loyer', flow: 'out', parent: 'Frais généraux', vatRate: 20 },
  { name: 'Assurances', flow: 'out', parent: 'Frais généraux' },
  { name: 'Logiciels et abonnements', flow: 'out', parent: 'Frais généraux', vatRate: 20 },
  { name: 'Honoraires', flow: 'out', parent: 'Frais généraux', vatRate: 20 },
  { name: 'Télécom', flow: 'out', parent: 'Frais généraux', vatRate: 20 },
  { name: 'TVA', flow: 'out', isVat: true },
  { name: 'Impôts et taxes', flow: 'out' },
  { name: 'Frais bancaires', flow: 'out' },
  { name: 'Remboursement d’emprunt', flow: 'out' },
];

export const CATEGORY_TEMPLATES: { key: string; name: string; description: string; categories: TemplateCategory[] }[] = [
  {
    key: 'commerce',
    name: 'Commerce',
    description: 'Ventes en magasin et en ligne, achats de marchandises, transport.',
    categories: [
      { name: 'Ventes en magasin', flow: 'in', kind: 'revenue', vatRate: 20 },
      { name: 'Ventes en ligne', flow: 'in', kind: 'revenue', vatRate: 20 },
      { name: 'Achats de marchandises', flow: 'out', kind: 'purchases', vatRate: 20 },
      { name: 'Transport et livraison', flow: 'out', kind: 'purchases', vatRate: 20 },
      { name: 'Marketing et publicité', flow: 'out', parent: 'Frais généraux', vatRate: 20 },
      ...common,
    ],
  },
  {
    key: 'services',
    name: 'Services',
    description: 'Prestations et abonnements clients, sous-traitance, déplacements.',
    categories: [
      { name: 'Prestations', flow: 'in', kind: 'revenue', vatRate: 20 },
      { name: 'Abonnements clients', flow: 'in', kind: 'revenue', vatRate: 20 },
      { name: 'Sous-traitance', flow: 'out', kind: 'purchases', vatRate: 20 },
      { name: 'Déplacements', flow: 'out', parent: 'Frais généraux', vatRate: 20 },
      ...common,
    ],
  },
  {
    key: 'btp',
    name: 'BTP',
    description: 'Chantiers et acomptes, matériaux, location de matériel, sous-traitance.',
    categories: [
      { name: 'Chantiers', flow: 'in', kind: 'revenue', vatRate: 20 },
      { name: 'Acomptes clients', flow: 'in', kind: 'revenue', vatRate: 20 },
      { name: 'Matériaux', flow: 'out', kind: 'purchases', vatRate: 20 },
      { name: 'Sous-traitance', flow: 'out', kind: 'purchases', vatRate: 20 },
      { name: 'Location de matériel', flow: 'out', kind: 'purchases', vatRate: 20 },
      { name: 'Carburant et véhicules', flow: 'out', parent: 'Frais généraux', vatRate: 20 },
      ...common,
    ],
  },
  {
    key: 'restauration',
    name: 'Restauration',
    description: 'Ventes sur place et à emporter, matières premières, boissons.',
    categories: [
      { name: 'Ventes sur place', flow: 'in', kind: 'revenue', vatRate: 10 },
      { name: 'Ventes à emporter', flow: 'in', kind: 'revenue', vatRate: 5.5 },
      { name: 'Matières premières', flow: 'out', kind: 'purchases', vatRate: 5.5 },
      { name: 'Boissons', flow: 'out', kind: 'purchases', vatRate: 20 },
      { name: 'Énergie', flow: 'out', parent: 'Frais généraux', vatRate: 20 },
      ...common,
    ],
  },
  {
    key: 'liberal',
    name: 'Profession libérale',
    description: 'Honoraires, rétrocessions, cotisations personnelles.',
    categories: [
      { name: 'Honoraires perçus', flow: 'in', kind: 'revenue', vatRate: 20 },
      { name: 'Rétrocessions', flow: 'out', kind: 'purchases', vatRate: 20 },
      { name: 'Cotisations personnelles', flow: 'out', kind: 'payroll' },
      { name: 'Formation', flow: 'out', parent: 'Frais généraux', vatRate: 20 },
      ...common,
    ],
  },
];

const norm = (s: string) => s.trim().toLocaleLowerCase('fr').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’']/g, "'");

/**
 * Catégories d'un modèle à créer : seulement celles qui manquent (même nom
 * dans le même sens), les parents avant les enfants. Rien n'est supprimé.
 */
export function templateAdditions(existing: Category[], template: TemplateCategory[]): TemplateCategory[] {
  const have = new Set(existing.map((c) => `${c.flow}|${norm(c.name)}`));
  const hasVat = existing.some((c) => c.isVat);
  const out: TemplateCategory[] = [];
  for (const t of template) {
    if (t.isVat && hasVat) continue;
    const k = `${t.flow}|${norm(t.name)}`;
    if (have.has(k)) continue;
    have.add(k);
    out.push(t);
  }
  return out.sort((a, b) => Number(!!a.parent) - Number(!!b.parent));
}

/** Nom déjà pris par une catégorie sœur ? */
export function nameTaken(categories: Category[], name: string, flow: Flow, parentId: string | null, exceptId?: string): boolean {
  return categories.some((c) => c.id !== exceptId && c.flow === flow && (c.parentId ?? null) === parentId && norm(c.name) === norm(name));
}
