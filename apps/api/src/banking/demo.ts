/**
 * Banque de démonstration : connexion immédiate, deux comptes et 90 jours
 * d'opérations réalistes, générés de façon déterministe. Permet d'essayer tout
 * le parcours bancaire sans contrat d'agrégation.
 */
import { addDays, todayInParis } from '@optimum/treso-engine';
import type { BankProvider, ProviderTransaction, SyncResult } from './provider';

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

const seedOf = (s: string) => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 7);

/** Opérations récurrentes : [jour du mois, libellé brut, montant de base, variation]. */
const MONTHLY: [number, string, number, number][] = [
  [2, 'PRLV SEPA LOYER SCI DES ARTISANS', -950, 0],
  [5, 'PRLV SEPA URSSAF AQUITAINE', -407, 40],
  [8, 'VIR SEPA EMIS SALAIRE {m}', -2150, 0],
  [10, 'PRLV SEPA ORANGE SA FACTURE', -69.84, 5],
  [12, 'CARTE X8502 {d} TOTALENERGIES STATION', -82, 25],
  [15, 'PRLV SEPA AXA ASSURANCES RC PRO', -151.2, 0],
  [18, 'FRAIS TENUE DE COMPTE', -18.5, 0],
  [21, 'PRLV SEPA OPTIMUM GESTION HONORAIRES', -348, 0],
  [25, 'CARTE X8502 {d} LEROY MERLIN', -240, 160],
];

const CLIENTS = ['MME LEGRAND SYLVIE', 'M BONNEFOND EMMANUEL', 'SARL CASTAGNET', 'M ROY JEAN FRANCOIS', 'MME ETTER', 'SCI LES PINS'];

export function demoTransactions(seed: string, today: string, days = 90): ProviderTransaction[] {
  const r = rng(seedOf(seed));
  const out: ProviderTransaction[] = [];
  const start = addDays(today, -days);
  const ref = () => Math.floor(r() * 9e6 + 1e6);
  for (let i = 0; i <= days; i++) {
    const date = addDays(start, i);
    const day = Number(date.slice(8, 10));
    const [y, m] = [date.slice(0, 4), date.slice(5, 7)];
    const dd = `${date.slice(8, 10)}/${m}`;
    for (const [d, label, base, vary] of MONTHLY) {
      if (d !== day) continue;
      const amount = Math.round((base + (vary ? (r() - 0.5) * 2 * vary : 0)) * 100) / 100;
      out.push({
        providerTransactionId: `demo-${date}-${d}`,
        providerAccountId: 'courant',
        bookedAt: date,
        rawLabel: label.replace('{m}', `${m}/${y}`).replace('{d}', dd) + ` ${ref()}`,
        amount,
      });
    }
    // Encaissements clients : 1 à 2 par semaine ouvrée
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
    if (weekday >= 1 && weekday <= 5 && r() < 0.32) {
      const client = CLIENTS[Math.floor(r() * CLIENTS.length)]!;
      out.push({
        providerTransactionId: `demo-${date}-in`,
        providerAccountId: 'courant',
        bookedAt: date,
        rawLabel: `VIR INST RECU ${client} FACTURE F-${y}-${String(Math.floor(r() * 300)).padStart(6, '0')}`,
        amount: Math.round((300 + r() * 1700) * 100) / 100,
      });
    }
  }
  // Un virement vers le livret et un remboursement fournisseur (exclusions automatiques)
  const mid = addDays(today, -20);
  out.push(
    { providerTransactionId: 'demo-transfer-out', providerAccountId: 'courant', bookedAt: mid, rawLabel: 'VIR SEPA EMIS VERS LIVRET PRO', amount: -1500 },
    { providerTransactionId: 'demo-transfer-in', providerAccountId: 'livret', bookedAt: addDays(mid, 1), rawLabel: 'VIR SEPA RECU DE COMPTE COURANT', amount: 1500 },
    { providerTransactionId: 'demo-refund-out', providerAccountId: 'courant', bookedAt: addDays(today, -12), rawLabel: 'CARTE X8502 AMAZON PAYMENTS', amount: -59.9 },
    { providerTransactionId: 'demo-refund-in', providerAccountId: 'courant', bookedAt: addDays(today, -4), rawLabel: 'CARTE X8502 AMAZON PAYMENTS', amount: 59.9 },
  );
  return out.sort((a, b) => a.bookedAt.localeCompare(b.bookedAt));
}

export const demoProvider: BankProvider = {
  id: 'demo',
  async link(req) {
    return { providerConnectionId: req.providerConnectionId ?? `demo-${req.companyId.slice(0, 8)}-${Date.now().toString(36)}` };
  },
  async sync(_companyId, providerConnectionId, since): Promise<SyncResult> {
    const today = todayInParis();
    const all = demoTransactions(providerConnectionId, today);
    const transactions = since ? all.filter((t) => t.bookedAt >= since.slice(0, 10)) : all;
    const courant = Math.round((8400 + all.filter((t) => t.providerAccountId === 'courant').reduce((s, t) => s + t.amount, 0)) * 100) / 100;
    const livret = Math.round((10_000 + all.filter((t) => t.providerAccountId === 'livret').reduce((s, t) => s + t.amount, 0)) * 100) / 100;
    return {
      bankName: 'Banque de démonstration',
      status: 'ok',
      statusDetail: null,
      accounts: [
        { providerAccountId: 'courant', name: 'Compte courant pro', type: 'checking', balance: courant, bookedBalance: courant, instantBalance: null, currency: 'EUR', ibanMasked: 'FR76 •••• •••• 4021' },
        { providerAccountId: 'livret', name: 'Livret pro', type: 'savings', balance: livret, bookedBalance: livret, instantBalance: null, currency: 'EUR', ibanMasked: 'FR76 •••• •••• 8840' },
      ],
      transactions,
    };
  },
  async disconnect() {
    /* rien à révoquer */
  },
};
