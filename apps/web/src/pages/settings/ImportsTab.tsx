import { useCallback, useEffect, useState } from 'react';
import { App, Button, Empty, Table } from 'antd';
import { api, ApiError } from '../../api/client';
import { canWrite, type ImportEntry } from '../../api/types';
import { useStore } from '../../store/useStore';

const typeLabels: Record<ImportEntry['type'], string> = { transactions: 'Opérations', commitments: 'Factures', budgets: 'Budgets' };

/** Historique des imports, annulables (Paramètres > Imports). */
export function ImportsTab() {
  const { message, modal } = App.useApp();
  const role = useStore((s) => s.role);
  const load = useStore((s) => s.load);
  const [rows, setRows] = useState<ImportEntry[] | null>(null);
  const refresh = useCallback(() => api<ImportEntry[]>('GET', '/imports').then(setRows).catch(() => setRows([])), []);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="settings-section" style={{ maxWidth: 900 }}>
      <Table<ImportEntry>
        rowKey="id"
        loading={!rows}
        dataSource={rows ?? []}
        pagination={{ pageSize: 20, hideOnSinglePage: true }}
        locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Aucun import pour l'instant. Importez un relevé depuis « Opérations bancaires »." /> }}
        columns={[
          { title: 'Fichier', dataIndex: 'fileName' },
          { title: 'Date', dataIndex: 'createdAt', render: (d: string) => new Date(d).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) },
          { title: 'Type', dataIndex: 'type', render: (t: ImportEntry['type']) => typeLabels[t] },
          { title: 'Lignes', dataIndex: 'rowsCount', align: 'right' },
          { title: 'Auteur', dataIndex: 'author', render: (a: string | null) => a ?? '—' },
          ...(canWrite(role)
            ? [
                {
                  title: '',
                  key: 'undo',
                  render: (_: unknown, r: ImportEntry) => (
                    <Button
                      size="small"
                      danger
                      onClick={() =>
                        modal.confirm({
                          title: "Annuler l'import ?",
                          content: `Les ${r.rowsCount} ${r.type === 'transactions' ? 'opérations' : 'éléments'} créés par cet import seront supprimés.`,
                          okText: "Annuler l'import",
                          okButtonProps: { danger: true },
                          cancelText: 'Garder',
                          onOk: async () => {
                            try {
                              await api('DELETE', `/imports/${encodeURIComponent(r.id)}`);
                              await Promise.all([refresh(), load()]);
                              message.success('Import annulé');
                            } catch (e) {
                              message.error(e instanceof ApiError ? e.message : "L'import n'a pas pu être annulé.");
                            }
                          },
                        })
                      }
                    >
                      Annuler l'import
                    </Button>
                  ),
                },
              ]
            : []),
        ]}
      />
    </div>
  );
}
