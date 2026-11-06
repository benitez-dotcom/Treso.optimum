/**
 * Jeu de données de démonstration « Atelier Démo » (cahier des charges, section 9).
 * Généré relativement à la date du jour, de façon déterministe.
 */
import {
  addMonths,
  averageFromHistory,
  categorizeIncoming,
  monthOf,
  monthRange,
  type BankAccount,
  type Budget,
  type Category,
  type Commitment,
  type IsoDate,
  type MonthKey,
  type Rule,
  type Scenario,
  type Transaction,
} from '@optimum/treso-engine';

export interface Indicator {
  id: string;
  name: string;
  formula: string;
  unit: string;
}

export interface DemoData {
  companyName: string;
  accounts: BankAccount[];
  categories: Category[];
  transactions: Transaction[];
  commitments: Commitment[];
  scenarios: Scenario[];
  budgets: Budget[];
  rules: Rule[];
  indicators: Indicator[];
}

/** Générateur pseudo-aléatoire déterministe (mulberry32). */
function rng(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const C = (
  id: string,
  name: string,
  flow: 'in' | 'out',
  position: number,
  extra: Partial<Category> = {},
): Category => ({ id, name, flow, parentId: null, position, kind: 'none', vatRate: 0, budgetAtParent: false, ...extra });

export const demoCategories: Category[] = [
  C('ventes', 'Ventes', 'in', 1, { kind: 'revenue', vatRate: 20 }),
  C('autres-enc', 'Autres encaissements', 'in', 2),
  C('remb-tva', 'Remboursement de TVA', 'in', 3),
  C('achats', 'Achats et sous-traitance', 'out', 1, { kind: 'purchases', vatRate: 20 }),
  C('rh', 'Salaires et charges', 'out', 2, { kind: 'payroll' }),
  C('salaires', 'Salaires nets', 'out', 1, { parentId: 'rh' }),
  C('urssaf', 'URSSAF', 'out', 2, { parentId: 'rh' }),
  C('pas', 'Prélèvement à la source', 'out', 3, { parentId: 'rh' }),
  C('mutuelle', 'Mutuelle', 'out', 4, { parentId: 'rh' }),
  C('fg', 'Frais généraux', 'out', 3, { kind: 'overheads' }),
  C('loyer', 'Loyer', 'out', 1, { parentId: 'fg', vatRate: 20 }),
  C('logiciels', 'Logiciels et abonnements', 'out', 2, { parentId: 'fg', vatRate: 20 }),
  C('assurances', 'Assurances', 'out', 3, { parentId: 'fg' }),
  C('honoraires', 'Honoraires', 'out', 4, { parentId: 'fg', vatRate: 20 }),
  C('tva', 'TVA', 'out', 4, { isVat: true }),
  C('impots', 'Impôts et taxes', 'out', 5),
  C('banque', 'Frais bancaires', 'out', 6),
  C('emprunt', 'Remboursement d\'emprunt', 'out', 7),
];

const clients = ['Studio Lumen', 'Menuiserie Laurent', 'Cabinet Arcade', 'Hôtel des Pins', 'Agence Boréal'];

const day = (month: MonthKey, d: number): IsoDate => `${month.slice(0, 8)}${String(d).padStart(2, '0')}`;

export function buildDemoData(today: IsoDate): DemoData {
  const rand = rng(20261106);
  const current = monthOf(today);
  const start = addMonths(current, -12);
  const past = monthRange(start, 13); // 12 mois complets + mois courant
  const tx: Transaction[] = [];
  let n = 0;
  const push = (bookedAt: IsoDate, amount: number, categoryId: string | null, rawLabel: string, counterparty: string, accountId = 'pro') => {
    if (bookedAt > today) return;
    tx.push({
      id: `tx-${++n}`,
      accountId,
      bookedAt,
      rawLabel,
      label: counterparty,
      counterparty,
      amount: Math.round(amount * 100) / 100,
      categoryId,
      hidden: false,
    });
  };

  for (const m of past) {
    const mon = Number(m.slice(5, 7));
    const season = 1 + 0.12 * Math.sin(((mon - 3) / 12) * 2 * Math.PI);
    const mm = m.slice(5, 7) + m.slice(2, 4);
    // Ventes : 4 règlements clients
    const salesTotal = 22_500 * season * (0.92 + rand() * 0.16);
    const shares = [0.34, 0.27, 0.22, 0.17];
    shares.forEach((s, i) => {
      const client = clients[(mon + i) % clients.length]!;
      push(day(m, 3 + i * 6), salesTotal * s, 'ventes', `VIR ${client.toUpperCase()} FA${mm}${i + 1}`, client);
    });
    if (rand() > 0.55) push(day(m, 18), 900 + rand() * 900, 'autres-enc', 'VIR REMBOURSEMENT ASSURANCE', 'Assureur Pro');
    // Achats
    push(day(m, 8), -(3200 + rand() * 900), 'achats', `PRLV SEPA BOIS ET MAT ${mm}`, 'Bois & Matériaux SA');
    push(day(m, 22), -(2600 + rand() * 1200), 'achats', `CB QUINCAILLERIE CENTRALE ${mm}`, 'Quincaillerie Centrale');
    // Salaires et charges
    push(day(m, 28), -(6900 + (mon === 12 ? 2700 : 0)), 'salaires', `VIR SALAIRES ${mm}`, 'Salaires');
    push(day(m, 15), -(2900 + rand() * 80), 'urssaf', `PRLV SEPA URSSAF ${mm}`, 'URSSAF');
    push(day(m, 15), -610, 'pas', `PRLV DGFIP PAS ${mm}`, 'DGFIP – Prélèvement à la source');
    push(day(m, 5), -182, 'mutuelle', `PRLV MUTUELLE ENTREPRISE ${mm}`, 'Mutuelle Entreprise');
    // Frais généraux
    push(day(m, 5), -1850, 'loyer', `PRLV LOYER ATELIER ${mm}`, 'SCI Les Ateliers');
    push(day(m, 10), -(236 + rand() * 20), 'logiciels', `CB LOGICIELS SAAS ${mm}`, 'Logiciels');
    if (mon % 3 === 1) push(day(m, 12), -620, 'assurances', `PRLV ASSURANCE MULTIRISQUE ${mm}`, 'Assureur Pro');
    push(day(m, 15), -420, 'honoraires', `PRLV CABINET COMPTABLE ${mm}`, 'Cabinet comptable');
    // TVA, impôts, banque, emprunt
    push(day(m, 20), -(1300 + rand() * 600), 'tva', `PRLV DGFIP TVA ${mm}`, 'DGFIP – TVA');
    if ([3, 6, 9, 12].includes(mon)) push(day(m, 14), -1500, 'impots', `PRLV DGFIP IS ACOMPTE ${mm}`, 'DGFIP – Impôt sur les sociétés');
    if (mon === 12) push(day(m, 14), -1180, 'impots', `PRLV DGFIP CFE ${mm}`, 'DGFIP – CFE');
    push(day(m, 2), -38, 'banque', `FRAIS TENUE DE COMPTE ${mm}`, 'Frais bancaires');
    push(day(m, 10), -750, 'emprunt', `ECH PRET PRO ${mm}`, 'Prêt professionnel');
    // Virement interne exclu des totaux
    push(day(m, 25), -2000, null, `VIR VERS LIVRET PRO ${mm}`, 'Virement interne');
    push(day(m, 25), 2000, null, `VIR DEPUIS COMPTE PRO ${mm}`, 'Virement interne', 'livret');
  }

  // Virements internes : exclus automatiquement (5.10)
  for (const t of tx) if (t.counterparty === 'Virement interne') t.hidden = true;

  // Les opérations des 12 derniers jours restent à catégoriser (flux « À traiter »)
  const cutoff = new Date(`${today}T12:00:00Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() - 12);
  const cutoffIso = cutoff.toISOString().slice(0, 10);
  const recent = tx.filter((t) => t.bookedAt > cutoffIso && !t.hidden);
  for (const t of recent) t.categoryId = null;

  // Règlement client sans catégorie, rapprochable d'une facture
  push(addDaysIso(today, -3), 5400, null, 'VIR STUDIO LUMEN FA-2026-108', 'Studio Lumen');

  const history = tx.filter((t) => t.categoryId);
  const rules: Rule[] = [
    { id: 'r-urssaf', conditions: [{ field: 'label', op: 'contains', value: 'URSSAF' }], categoryId: 'urssaf', autoApply: false, priority: 10 },
  ];
  const withSuggestions = categorizeIncoming(tx, rules, history);

  // Soldes : la somme des opérations part de 28 000 € (pro) et 15 000 € (livret)
  const sumFor = (acc: string) => withSuggestions.filter((t) => t.accountId === acc).reduce((s, t) => s + t.amount, 0);
  const accounts: BankAccount[] = [
    { id: 'pro', name: 'Compte pro', bankName: 'Banque Exemple', balance: Math.round((28_000 + sumFor('pro')) * 100) / 100, isActive: true },
    { id: 'livret', name: 'Livret pro', bankName: 'Banque Exemple', balance: Math.round((15_000 + sumFor('livret')) * 100) / 100, isActive: true },
  ];

  // Factures engagées
  const commitments: Commitment[] = [];
  let c = 0;
  const inv = (flow: 'in' | 'out', counterparty: string, number: string, amount: number, dueOffset: number, categoryId: string) => {
    const dueAt = addDaysIso(today, dueOffset);
    commitments.push({
      id: `inv-${++c}`,
      flow,
      counterparty,
      number,
      label: number,
      amountInclTax: amount,
      vatRate: 20,
      issuedAt: addDaysIso(dueAt, -30),
      dueAt,
      status: 'pending',
      categoryId,
      hidden: false,
      accountId: 'pro',
    });
  };
  inv('in', 'Menuiserie Laurent', 'FA-2026-097', 2_450, -12, 'ventes');
  inv('in', 'Hôtel des Pins', 'FA-2026-101', 2_400, -5, 'ventes');
  inv('in', 'Studio Lumen', 'FA-2026-108', 5_400, -2, 'ventes');
  inv('in', 'Menuiserie Laurent', 'FA-2026-112', 3_600, 6, 'ventes');
  inv('in', 'Cabinet Arcade', 'FA-2026-115', 4_980, 14, 'ventes');
  inv('in', 'Agence Boréal', 'FA-2026-118', 6_240, 34, 'ventes');
  inv('in', 'Hôtel des Pins', 'FA-2026-121', 7_800, 52, 'ventes');
  inv('out', 'Bois & Matériaux SA', 'BM-88412', 4_120, 19, 'achats');
  inv('out', 'Quincaillerie Centrale', 'QC-2219', 1_960, 27, 'achats');
  inv('out', 'Atelier Métal', 'AM-551', 3_300, 45, 'achats');
  inv('out', 'Cabinet comptable', 'HON-1126', 1_440, 24, 'honoraires');

  // Scénarios et budgets : moyenne des 6 derniers mois, sur 12 mois
  const scenarios: Scenario[] = [
    { id: 'base', name: 'Scénario de base', color: '#114C5C', isBase: true },
    { id: 'recrutement', name: 'Recrutement en mars', color: '#8A6FB0', isBase: false },
  ];
  const averages = averageFromHistory(demoCategories, withSuggestions, current, 6);
  const budgets: Budget[] = [];
  const future = monthRange(current, 12);
  for (const m of future) {
    const mon = Number(m.slice(5, 7));
    const season = 1 + 0.12 * Math.sin(((mon - 3) / 12) * 2 * Math.PI);
    for (const cat of demoCategories) {
      if (demoCategories.some((k) => k.parentId === cat.id)) continue;
      let amount = averages.get(cat.id) ?? 0;
      if (cat.id === 'ventes') amount = Math.round((22_500 * season) / 100) * 100;
      if (cat.id === 'salaires' && mon === 12) amount = 9_600;
      if (cat.id === 'impots') amount = [3, 6, 9].includes(mon) ? 1_500 : mon === 12 ? 2_700 : mon === 1 ? 4_800 : 0;
      if (cat.id === 'assurances') amount = mon % 3 === 1 ? 620 : 0;
      if (cat.id === 'autres-enc') amount = 600;
      if (cat.id === 'remb-tva' || cat.id === 'banque') amount = cat.id === 'banque' ? 38 : 0;
      amount = Math.round(amount / 10) * 10;
      if (amount > 0) budgets.push({ scenarioId: 'base', categoryId: cat.id, month: m, amount });
    }
  }
  // Scénario alternatif : recrutement d'un commercial à partir de mars
  const march = future.find((m) => m.slice(5, 7) === '03') ?? addMonths(current, 4);
  for (const m of future.filter((x) => x >= march)) {
    const base = (id: string) => budgets.find((b) => b.scenarioId === 'base' && b.categoryId === id && b.month === m)?.amount ?? 0;
    budgets.push({ scenarioId: 'recrutement', categoryId: 'salaires', month: m, amount: base('salaires') + 2_400 });
    budgets.push({ scenarioId: 'recrutement', categoryId: 'urssaf', month: m, amount: base('urssaf') + 1_150 });
  }

  return {
    companyName: 'Atelier Démo',
    accounts,
    categories: demoCategories,
    transactions: withSuggestions,
    commitments,
    scenarios,
    budgets,
    rules,
    indicators: [{ id: 'ind-achats', name: 'Taux d\'achats consommés', formula: '[Achats et sous-traitance] / 1,2 / ([Ventes] / 1,1) * 100', unit: '%' }],
  };
}

function addDaysIso(date: IsoDate, n: number): IsoDate {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
