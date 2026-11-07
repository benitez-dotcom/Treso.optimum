/** Import de factures depuis un fichier CSV ou XLSX, en 3 étapes (écran 7.8). */
import { useMemo, useState } from 'react';
import { Alert, App, Button, Checkbox, Modal, Select, Steps, Table, Upload } from 'antd';
import { InboxOutlined } from '@ant-design/icons';
import {
  formatDate,
  formatEuro,
  guessInvoiceMapping,
  INVOICE_FIELD_LABELS,
  missingInvoiceFields,
  previewInvoiceImport,
  type Flow,
  type InvoiceImportField,
  type InvoiceMapping,
} from '@optimum/treso-engine';
import { api, ApiError } from '../../api/client';
import { accountLabel } from '../../api/types';
import { useStore } from '../../store/useStore';
import { downloadText, readSheet } from '../../components/spreadsheet';

const FIELDS = (Object.keys(INVOICE_FIELD_LABELS) as InvoiceImportField[]).map((f) => ({
  value: f,
  label: f === 'ignore' ? 'Ne pas importer' : INVOICE_FIELD_LABELS[f],
}));

const sample = (flow: Flow) =>
  `${flow === 'in' ? 'Client' : 'Fournisseur'};Numéro;Date;Échéance;Montant TTC;Taux de TVA;Catégorie;Libellé\n` +
  (flow === 'in'
    ? 'Studio Lumen;FA-2026-130;07/11/2026;07/12/2026;5 400,00;20;Ventes;Site internet\nHôtel des Pins;FA-2026-131;07/11/2026;22/12/2026;2 400,00;20;Ventes;Maintenance\n'
    : 'Bois & Matériaux SA;BM-90012;05/11/2026;05/12/2026;4 120,00;20;Achats et sous-traitance;Panneaux chêne\n');

export function InvoiceImportWizard({ open, flow, onClose }: { open: boolean; flow: Flow; onClose: () => void }) {
  const { message } = App.useApp();
  const accounts = useStore((s) => s.accounts);
  const categories = useStore((s) => s.categories);
  const commitments = useStore((s) => s.commitments);
  const today = useStore((s) => s.today);
  const load = useStore((s) => s.load);
  const [step, setStep] = useState(0);
  const [fileName, setFileName] = useState('');
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [mapping, setMapping] = useState<InvoiceMapping>({});
  const [accountId, setAccountId] = useState<string | null>(null);
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const close = () => {
    setStep(0);
    setFileName('');
    setHeaders([]);
    setRows([]);
    setError(null);
    onClose();
  };

  const readFile = (file: File) => {
    setError(null);
    void readSheet(file)
      .then(async (sheet) => {
        if (sheet.headers.length < 2 || sheet.rows.length === 0) {
          setError('Il faut une ligne d’en-têtes puis une ligne par facture.');
          return;
        }
        let previous: InvoiceMapping | null = null;
        try {
          previous = (await api<{ mapping: InvoiceMapping | null }>('GET', '/import-mappings/commitments')).mapping;
        } catch {
          /* rien de mémorisé */
        }
        setFileName(file.name);
        setHeaders(sheet.headers);
        setRows(sheet.rows);
        setMapping(guessInvoiceMapping(sheet.headers, previous));
        setStep(1);
      })
      .catch((e: Error) => setError(e.message));
    return false;
  };

  const missing = useMemo(() => missingInvoiceFields(mapping), [mapping]);
  const preview = useMemo(
    () => (step >= 2 ? previewInvoiceImport(rows, mapping, { flow, categories, existing: commitments, today }) : null),
    [step, rows, mapping, flow, categories, commitments, today],
  );
  const toImport = preview ? preview.rows.filter((r) => !(skipDuplicates && preview.duplicates.includes(r.line))) : [];

  const submit = async () => {
    setSaving(true);
    try {
      const res = await api<{ imported: number; importId: string }>('POST', '/commitments/import', {
        flow,
        accountId,
        fileName,
        mapping,
        rows: toImport.map((r) => ({
          counterparty: r.counterparty,
          number: r.number,
          label: r.label,
          amountInclTax: r.amountInclTax,
          vatRate: r.vatRate,
          issuedAt: r.issuedAt,
          dueAt: r.dueAt,
          categoryId: r.categoryId,
          note: r.note,
        })),
      });
      await load();
      message.success(`${res.imported} facture${res.imported > 1 ? 's' : ''} importée${res.imported > 1 ? 's' : ''}. Vous pouvez annuler cet import dans Paramètres › Imports.`);
      close();
    } catch (e) {
      message.error(e instanceof ApiError ? e.message : 'L’import a échoué.');
    } finally {
      setSaving(false);
    }
  };

  const sampleRows = rows.slice(0, 5);

  return (
    <Modal
      open={open}
      onCancel={close}
      width={900}
      title={flow === 'in' ? 'Importer des factures clients' : 'Importer des factures fournisseurs'}
      destroyOnHidden
      footer={[
        step > 0 && (
          <Button key="back" onClick={() => setStep(step - 1)}>
            Précédent
          </Button>
        ),
        step === 1 && (
          <Button key="next" type="primary" disabled={missing.length > 0} onClick={() => setStep(2)}>
            Vérifier
          </Button>
        ),
        step === 2 && (
          <Button key="go" type="primary" loading={saving} disabled={toImport.length === 0} onClick={submit}>
            Importer {toImport.length} ligne{toImport.length > 1 ? 's' : ''}
          </Button>
        ),
      ]}
    >
      <Steps size="small" current={step} items={[{ title: 'Fichier' }, { title: 'Correspondance' }, { title: 'Vérification' }]} className="assistant-steps" />
      {step === 0 && (
        <div className="stack">
          <Upload.Dragger accept=".csv,.txt,.xlsx" beforeUpload={readFile} showUploadList={false} multiple={false}>
            <p className="ant-upload-drag-icon">
              <InboxOutlined />
            </p>
            <p className="ant-upload-text">Déposez un fichier CSV ou XLSX, ou cliquez pour le choisir</p>
            <p className="ant-upload-hint">Une ligne d’en-têtes, puis une ligne par facture. Séparateur et encodage détectés automatiquement.</p>
          </Upload.Dragger>
          {error && <Alert type="error" showIcon message={error} />}
          <Button type="link" onClick={() => downloadText(flow === 'in' ? 'modele-factures-clients.csv' : 'modele-factures-fournisseurs.csv', sample(flow))}>
            Télécharger un fichier modèle
          </Button>
        </div>
      )}
      {step === 1 && (
        <div className="stack">
          <div className="import-account">
            <label htmlFor="inv-import-account">Compte du paiement</label>
            <Select
              id="inv-import-account"
              allowClear
              placeholder="Compte par défaut des factures"
              value={accountId ?? undefined}
              onChange={(v) => setAccountId(v ?? null)}
              options={accounts.map((a) => ({ value: a.id, label: accountLabel(a) }))}
              style={{ minWidth: 260 }}
            />
          </div>
          {missing.length > 0 && <Alert type="warning" showIcon message={`Associez une colonne à : ${missing.join(', ')}.`} />}
          <div className="mapping-scroll">
            <table className="mapping-table">
              <thead>
                <tr>
                  {headers.map((h) => (
                    <th key={h}>
                      <div className="mapping-head">{h}</div>
                      <Select
                        size="small"
                        value={mapping[h]}
                        onChange={(f: InvoiceImportField) =>
                          setMapping((m) => {
                            const next = { ...m };
                            // Un champ ne s'associe qu'à une colonne
                            if (f !== 'ignore') for (const k of Object.keys(next)) if (next[k] === f) next[k] = 'ignore';
                            next[h] = f;
                            return next;
                          })
                        }
                        options={FIELDS}
                        style={{ width: 160 }}
                        aria-label={`Champ pour la colonne ${h}`}
                      />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sampleRows.map((r, i) => (
                  <tr key={i}>
                    {headers.map((h) => (
                      <td key={h} className={mapping[h] === 'ignore' ? 'muted' : undefined}>
                        {String(r[h] ?? '')}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted">Correspondance mémorisée pour votre prochain import.</p>
        </div>
      )}
      {step === 2 && preview && (
        <div className="stack">
          <div className="import-summary">
            <strong>{preview.rows.length} ligne{preview.rows.length > 1 ? 's' : ''} valide{preview.rows.length > 1 ? 's' : ''}</strong>
            {preview.errors.length > 0 && <span className="text-danger">{preview.errors.length} en erreur</span>}
            {preview.duplicates.length > 0 && (
              <Checkbox checked={skipDuplicates} onChange={(e) => setSkipDuplicates(e.target.checked)}>
                Ignorer {preview.duplicates.length} doublon{preview.duplicates.length > 1 ? 's' : ''} déjà présent{preview.duplicates.length > 1 ? 's' : ''}
              </Checkbox>
            )}
          </div>
          {preview.errors.length > 0 && (
            <Alert
              type="error"
              message="Lignes ignorées"
              description={
                <ul className="import-errors">
                  {preview.errors.slice(0, 8).map((e) => (
                    <li key={e.line}>{e.message}</li>
                  ))}
                  {preview.errors.length > 8 && <li>… et {preview.errors.length - 8} autres</li>}
                </ul>
              }
            />
          )}
          {preview.unknownCategories.length > 0 && (
            <Alert type="info" showIcon message={`Catégories inconnues (factures importées « À catégoriser ») : ${preview.unknownCategories.join(', ')}.`} />
          )}
          <Table
            size="small"
            rowKey="line"
            pagination={{ pageSize: 8, hideOnSinglePage: true }}
            dataSource={preview.rows}
            rowClassName={(r) => (skipDuplicates && preview.duplicates.includes(r.line) ? 'row-duplicate' : '')}
            columns={[
              { title: 'Ligne', dataIndex: 'line', width: 60 },
              { title: 'Tiers', dataIndex: 'counterparty' },
              { title: 'Numéro', dataIndex: 'number' },
              { title: 'Échéance', dataIndex: 'dueAt', render: (d: string) => formatDate(d) },
              { title: 'Catégorie', render: (_, r) => (r.categoryId ? categories.find((c) => c.id === r.categoryId)?.name : <span className="muted">À catégoriser</span>) },
              { title: 'Montant TTC', dataIndex: 'amountInclTax', align: 'right', render: (v: number) => <span className="num">{formatEuro(v)}</span> },
            ]}
          />
        </div>
      )}
    </Modal>
  );
}
