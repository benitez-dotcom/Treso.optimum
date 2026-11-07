/** Données de la pré-comptabilité (chargées à l'ouverture de la page). */
import { useCallback, useEffect, useState } from 'react';
import type { Entry, Journals, LedgerAccount, VatAccounts } from '@optimum/treso-engine';
import { api } from '../../api/client';

export interface PrecomptaSettings {
  provider: 'none' | 'demo' | 'other';
  software: string | null;
  dossierCode: string | null;
  vat: VatAccounts;
  journals: Journals;
  suspense: string;
}

export interface PrecomptaData {
  settings: PrecomptaSettings;
  chart: LedgerAccount[];
  mappings: Record<string, string>;
  entries: Entry[];
}

export function usePrecompta() {
  const [data, setData] = useState<PrecomptaData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    try {
      setData(await api<PrecomptaData>('GET', '/precompta'));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Chargement impossible.');
    }
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);
  const setEntries = (entries: Entry[]) => setData((d) => (d ? { ...d, entries } : d));
  const patch = (p: Partial<PrecomptaData>) => setData((d) => (d ? { ...d, ...p } : d));
  return { data, error, reload, setEntries, patch };
}
