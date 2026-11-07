/**
 * Fournisseurs d'agrégation bancaire. L'API ne parle qu'à cette interface :
 * la banque de démonstration (toujours disponible) et Bridge (si configuré).
 */
import type { AccountType } from '@optimum/treso-engine';

export interface ProviderAccount {
  providerAccountId: string;
  name: string;
  type: AccountType;
  balance: number | null;
  bookedBalance: number | null;
  instantBalance: number | null;
  currency: string;
  ibanMasked: string | null;
}

export interface ProviderTransaction {
  providerTransactionId: string;
  providerAccountId: string;
  bookedAt: string;
  rawLabel: string;
  amount: number;
}

export interface SyncResult {
  bankName: string;
  status: 'ok' | 'action_required' | 'error';
  statusDetail: string | null;
  accounts: ProviderAccount[];
  transactions: ProviderTransaction[];
}

export interface LinkRequest {
  companyId: string;
  userEmail: string;
  /** URL de retour vers l'application après la connexion chez l'agrégateur. */
  callbackUrl: string;
  /** Connexion existante à réparer (renouvellement d'accès, code SCA). */
  providerConnectionId?: string | null;
}

export interface BankProvider {
  id: 'demo' | 'bridge';
  /** Démarre le parcours de connexion : URL de redirection, ou connexion immédiate (démo). */
  link(req: LinkRequest): Promise<{ redirectUrl: string } | { providerConnectionId: string }>;
  /** Récupère comptes et opérations d'une connexion (depuis `since` si fourni). */
  sync(companyId: string, providerConnectionId: string, since: string | null): Promise<SyncResult>;
  /** Révoque l'accès chez l'agrégateur (les données restent chez nous). */
  disconnect(companyId: string, providerConnectionId: string): Promise<void>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    public status?: number,
  ) {
    super(message);
  }
}
