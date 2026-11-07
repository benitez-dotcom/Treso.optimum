/**
 * Adaptateur Bridge API v3 (agrégateur agréé ACPR, accès en lecture seule).
 * Documentation : https://docs.bridgeapi.io — à valider sur le bac à sable
 * Bridge avec de vrais identifiants avant la mise en production.
 *
 * Parcours : utilisateur Bridge par société (`external_user_id` = id société)
 * → jeton utilisateur → session de connexion (URL hébergée par Bridge) → retour
 * sur `callbackUrl` avec `item_id` → synchronisation des comptes et opérations.
 */
import type { AccountType } from '@optimum/treso-engine';
import type { Config } from '../config';
import { ProviderError, type BankProvider, type ProviderAccount, type ProviderTransaction, type SyncResult } from './provider';

type BridgeConfig = NonNullable<Config['bridge']>;

interface BridgeList<T> {
  resources: T[];
  pagination?: { next_uri?: string | null };
}

interface BridgeItem {
  id: number;
  status: number;
  status_code_info?: string | null;
  status_code_description?: string | null;
  provider_id: number;
}

interface BridgeAccount {
  id: number;
  name: string;
  balance: number | null;
  accounting_balance?: number | null;
  instant_balance?: number | null;
  type: string;
  currency_code: string;
  item_id: number;
  iban?: string | null;
}

interface BridgeTransaction {
  id: number;
  clean_description?: string;
  provider_description?: string;
  amount: number;
  date: string;
  booking_date?: string | null;
  account_id: number;
  deleted?: boolean;
  future?: boolean;
}

const TYPE_MAP: Record<string, AccountType> = {
  checking: 'checking',
  savings: 'savings',
  card: 'card',
  loan: 'loan',
  brokerage: 'other',
  life_insurance: 'other',
  shared_savings_plan: 'other',
};

/** Statuts d'item Bridge : 0 = à jour ; 1010/1100 = action utilisateur ; autres = erreur. */
function itemStatus(item: BridgeItem): Pick<SyncResult, 'status' | 'statusDetail'> {
  if (item.status === 0) return { status: 'ok', statusDetail: null };
  if ([402, 429, 1010, 1100, 1003].includes(item.status)) {
    return { status: 'action_required', statusDetail: item.status_code_description ?? 'Votre banque demande une validation.' };
  }
  return { status: 'error', statusDetail: item.status_code_description ?? `Erreur de synchronisation (${item.status}).` };
}

const maskIban = (iban?: string | null) => (iban ? `${iban.slice(0, 4)} •••• •••• ${iban.slice(-4)}` : null);

export function createBridgeProvider(cfg: BridgeConfig): BankProvider {
  const base = cfg.baseUrl.replace(/\/$/, '');
  const headers = (token?: string) => ({
    'Client-Id': cfg.clientId,
    'Client-Secret': cfg.clientSecret,
    'Bridge-Version': cfg.version,
    accept: 'application/json',
    'content-type': 'application/json',
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  });

  async function call<T>(method: string, path: string, body?: unknown, token?: string): Promise<T> {
    const res = await fetch(path.startsWith('http') ? path : `${base}${path}`, {
      method,
      headers: headers(token),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new ProviderError(`Bridge ${method} ${path} : ${res.status} ${text.slice(0, 200)}`, res.status);
    }
    return (res.status === 204 ? null : await res.json()) as T;
  }

  /** Crée l'utilisateur Bridge de la société s'il n'existe pas, puis renvoie un jeton. */
  async function userToken(companyId: string): Promise<string> {
    try {
      await call('POST', '/v3/aggregation/users', { external_user_id: companyId });
    } catch (e) {
      if (!(e instanceof ProviderError && e.status === 409)) throw e;
    }
    const t = await call<{ access_token: string }>('POST', '/v3/aggregation/authorization/token', { external_user_id: companyId });
    return t.access_token;
  }

  async function all<T>(path: string, token: string): Promise<T[]> {
    const out: T[] = [];
    let next: string | null = path;
    for (let guard = 0; next && guard < 50; guard++) {
      const page: BridgeList<T> = await call<BridgeList<T>>('GET', next, undefined, token);
      out.push(...page.resources);
      next = page.pagination?.next_uri ?? null;
    }
    return out;
  }

  return {
    id: 'bridge',
    async link(req) {
      const token = await userToken(req.companyId);
      const session = await call<{ url: string }>(
        'POST',
        '/v3/aggregation/connect-sessions',
        { user_email: req.userEmail, callback_url: req.callbackUrl, ...(req.providerConnectionId ? { item_id: Number(req.providerConnectionId) } : {}) },
        token,
      );
      return { redirectUrl: session.url };
    },

    async sync(companyId, providerConnectionId, since) {
      const token = await userToken(companyId);
      const item = await call<BridgeItem>('GET', `/v3/aggregation/items/${providerConnectionId}`, undefined, token);
      const provider = await call<{ name: string }>('GET', `/v3/providers/${item.provider_id}`).catch(() => ({ name: 'Banque' }));
      const accounts = await all<BridgeAccount>(`/v3/aggregation/accounts?item_id=${providerConnectionId}&limit=200`, token);
      const ids = new Set(accounts.map((a) => a.id));
      const query = `/v3/aggregation/transactions?limit=500${since ? `&since=${encodeURIComponent(since)}` : ''}`;
      const transactions = (await all<BridgeTransaction>(query, token)).filter((t) => ids.has(t.account_id) && !t.deleted && !t.future);
      return {
        bankName: provider.name,
        ...itemStatus(item),
        accounts: accounts.map(
          (a): ProviderAccount => ({
            providerAccountId: String(a.id),
            name: a.name,
            type: TYPE_MAP[a.type] ?? 'other',
            balance: a.balance,
            bookedBalance: a.accounting_balance ?? null,
            instantBalance: a.instant_balance ?? null,
            currency: a.currency_code,
            ibanMasked: maskIban(a.iban),
          }),
        ),
        transactions: transactions.map(
          (t): ProviderTransaction => ({
            providerTransactionId: String(t.id),
            providerAccountId: String(t.account_id),
            bookedAt: (t.booking_date ?? t.date).slice(0, 10),
            rawLabel: t.provider_description || t.clean_description || 'Opération',
            amount: t.amount,
          }),
        ),
      };
    },

    async disconnect(companyId, providerConnectionId) {
      const token = await userToken(companyId);
      await call('DELETE', `/v3/aggregation/items/${providerConnectionId}`, undefined, token);
    },
  };
}
