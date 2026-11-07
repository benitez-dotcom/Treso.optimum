import { useMemo, useState } from 'react';
import Papa from 'papaparse';
import { Alert, App, Button, Checkbox, Modal, Select, Steps, Table, Upload } from 'antd';
import { InboxOutlined } from '@ant-design/icons';
import {
  formatDate,
  formatEuro,
  guessMapping,
  missingFields,
  previewImport,
  type ImportMapping,
  type TransactionImportField,
} from '@optimum/treso-engine';
import { api, ApiError } from '../api/client';
import { accountLabel } from '../api/types';
import { useStore } from '../store/useStore';

const fieldOptions: { value: TransactionImportField; label: string }[] = [
  { value: 'date', label: 'Date' },
  { value: 'label', label: 'Libellé' },
  { value: 'amount', label: 'Montant (signé)' },
  { value: 'debit', label: 'Débit' },
  { value: 'credit', label: 'Crédit' },
  { value: 'category', label: 'Catégorie' },
  { value: 'note', label: 'Note' },
  { value: 'externalId', label: 'Identifiant' },
  { value: 'ignore', label: 'Ne pas importer' },
];

const SAMPLE = 'Date;Libellé;Montant;Catégorie\n05/11/2026;PRLV SEPA URSSAF;-407,00;URSSAF\n06/11/2026;VIR CLIENT DUPONT FACTURE 123;1 013,56;Ventes\n';

function downloadSample() {
  const url = URL.createObjectURL(new Blob(['﻿' + SAMPLE], { type: 'text/csv;charset=utf-8' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: 'exemple-operations.csv' });
  a.click();
  URL.revokeObjectURL(url);
}

/** Import d'opérations depuis un fichier CSV, en 3 étapes : fichier, correspondance, vérification. */
export function ImportWizard({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { message } = App.useApp();
  const accounts = useStore((s) => s.accounts);
  const transactions = useStore((s) => s.transactions);
  const load = useStore((s) => s.load);
  const [step, setStep] = useState(0);
  const [fileName, setFileName] = useState('');
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [mapping, setMapping] = useState<ImportMapping>({});
  const [accountId, setAccountId] = useState<string | undefined>(accounts.find((a) => a.isManual)?.id ?? accounts[0]?.id);
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const [parseError, setParseError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setStep(0);
    setFileName('');
    setHeaders([]);
    setRows([]);
    setParseError(null);
  };
  const close = () => {
    reset();
    onClose();
  };

  const readFile = (file: File) => {
    setParseError(null);
    void decodeFile(file).then((text) => parseText(text, file.name));
    return false;
  };

  /** Les exports bancaires français sont souvent en Windows-1252 : on essaie l'UTF-8 strict, sinon ce jeu-là. */
  const decodeFile = async (file: File) => {
    const buf = await file.arrayBuffer();
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(buf);
    } catch {
      return new TextDecoder('windows-1252').decode(buf);
    }
  };

  const parseText = (text: string, name: string) => {
    Papa.parse<Record<string, unknown>>(text, {
      header: true,
      skipEmptyLines: 'greedy',
      transformHeader: (h) => h.replace(/^﻿/, '').trim(),
      complete: async (res) => {
        const hs = (res.meta.fields ?? []).filter(Boolean);
        if (hs.length < 2 || res.data.length === 0) {
          setParseError("Ce fichier ne ressemble pas à un relevé : il faut une ligne d'en-têtes puis une ligne par opération.");
          return;
        }
        let previous: ImportMapping | null = null;
        try {
          previous = (await api<{ mapping: ImportMapping | null }>('GET', '/import-mappings/transactions')).mapping;
        } catch {
          /* pas de correspondance mémorisée */
        }
        setFileName(name);
        setHeaders(hs);
        setRows(res.data);
        setMapping(guessMapping(hs, previous));
        setStep(1);
      },
      error: (err: Error) => setParseError(`Lecture impossible : ${err.message}`),
    });
  };

  const missing = useMemo(() => missingFields(mapping), [mapping]);
  const accountTx = useMemo(() => transactions.filter((t) => t.accountId === accountId && !t.parentId), [transactions, accountId]);
  const preview = useMemo(() => (step >= 2 ? previewImport(rows, mapping, accountTx) : null), [step, rows, mapping, accountTx]);
  const toImport = preview ? preview.rows.filter((r) => !(skipDuplicates && preview.duplicates.includes(r.line))) : [];

  const submit = async () => {
    if (!accountId || toImport.length === 0) return;
    setSaving(true);
    try {
      const res = await api<{ imported: number }>('POST', '/transactions/import', {
        fileName,
        accountId,
        mapping,
        rows: toImport.map((r) => ({ bookedAt: r.bookedAt, rawLabel: r.rawLabel, amount: r.amount, categoryName: r.categoryName, note: r.note })),
      });
      await load();
      message.success(`Import terminé : ${res.imported} opération${res.imported > 1 ? 's' : ''}`);
      close();
    } catch (e) {
      message.error(e instanceof ApiError ? e.message : "L'import a échoué.");
    } finally {
      setSaving(false);
    }
  };

  const footer = [
    step > 0 && (
      <Button key="back" onClick={() => setStep((s) => s - 1)}>
        Étape précédente
      </Button>
    ),
    <Button key="cancel" onClick={close}>
      Annuler
    </Button>,
    step === 1 && (
      <Button key="next" type="primary" disabled={missing.length > 0 || !accountId} onClick={() => setStep(2)}>
        Vérifier
      </Button>
    ),
    step === 2 && (
      <Button key="go" type="primary" loading={saving} disabled={toImport.length === 0} onClick={submit}>
        Importer {toImport.length} opération{toImport.length > 1 ? 's' : ''}
      </Button>
    ),
  ].filter(Boolean);

  return (
    <Modal open={open} onCancel={close} title="Importer des opérations" width={820} footer={footer} destroyOnHidden>
      <Steps size="small" current={step} items={[{ title: 'Fichier' }, { title: 'Correspondance' }, { title: 'Vérification' }]} style={{ marginBottom: 20 }} />

      {step === 0 && (
        <>
          <Upload.Dragger accept=".csv,text/csv" showUploadList={false} beforeUpload={readFile} multiple={false}>
            <p className="ant-upload-drag-icon">
              <InboxOutlined />
            </p>
            <p className="ant-upload-text">Glissez votre fichier CSV ici, ou cliquez pour le choisir</p>
            <p className="ant-upload-hint">Export de votre banque ou de votre tableur : une ligne d'en-têtes, puis une opération par ligne.</p>
          </Upload.Dragger>
          {parseError && <Alert type="error" showIcon message={parseError} style={{ marginTop: 12 }} />}
          <Button type="link" onClick={downloadSample} style={{ paddingLeft: 0, marginTop: 8 }}>
            Télécharger un fichier exemple
          </Button>
        </>
      )}

      {step === 1 && (
        <>
          <div className="import-account">
            <label htmlFor="import-account">Compte concerné</label>
            <Select
              id="import-account"
              value={accountId}
              onChange={setAccountId}
              style={{ minWidth: 280 }}
              options={accounts.map((a) => ({ value: a.id, label: `${accountLabel(a)} · ${a.bankName}` }))}
            />
          </div>
          <p className="muted">Vérifiez la correspondance des colonnes de « {fileName} ». Elle sera mémorisée pour vos prochains imports.</p>
          <Table
            size="small"
            pagination={false}
            rowKey="header"
            dataSource={headers.map((h) => ({ header: h, sample: rows.slice(0, 2).map((r) => String(r[h] ?? '')).join(' · ') }))}
            columns={[
              { title: 'Colonne du fichier', dataIndex: 'header', width: 200 },
              { title: 'Exemple', dataIndex: 'sample', render: (v: string) => <span className="muted">{v}</span> },
              {
                title: 'Correspond à',
                width: 200,
                render: (_: unknown, r: { header: string }) => (
                  <Select
                    value={mapping[r.header] ?? 'ignore'}
                    onChange={(v: TransactionImportField) => setMapping((m) => ({ ...m, [r.header]: v }))}
                    options={fieldOptions}
                    style={{ width: '100%' }}
                    aria-label={`Champ pour la colonne ${r.header}`}
                  />
                ),
              },
            ]}
          />
          {missing.length > 0 && <Alert type="warning" showIcon style={{ marginTop: 12 }} message={`Les champs suivants sont requis : ${missing.join(', ')}.`} />}
        </>
      )}

      {step === 2 && preview && (
        <>
          <div className="import-summary">
            <span>
              <strong>{preview.rows.length}</strong> opération{preview.rows.length > 1 ? 's' : ''} lue{preview.rows.length > 1 ? 's' : ''}
            </span>
            {preview.errors.length > 0 && <span className="text-danger">{preview.errors.length} ligne{preview.errors.length > 1 ? 's' : ''} ignorée{preview.errors.length > 1 ? 's' : ''}</span>}
            {preview.duplicates.length > 0 && (
              <Checkbox checked={skipDuplicates} onChange={(e) => setSkipDuplicates(e.target.checked)}>
                Ignorer {preview.duplicates.length} doublon{preview.duplicates.length > 1 ? 's' : ''} déjà présent{preview.duplicates.length > 1 ? 's' : ''}
              </Checkbox>
            )}
          </div>
          {preview.errors.length > 0 && (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 12 }}
              message="Lignes non importées"
              description={
                <ul className="import-errors">
                  {preview.errors.slice(0, 8).map((e) => (
                    <li key={e.line}>
                      Ligne {e.line} : {e.message}
                    </li>
                  ))}
                  {preview.errors.length > 8 && <li>… et {preview.errors.length - 8} autres.</li>}
                </ul>
              }
            />
          )}
          <Table
            size="small"
            rowKey="line"
            pagination={{ pageSize: 8, showSizeChanger: false }}
            dataSource={preview.rows}
            rowClassName={(r) => (preview.duplicates.includes(r.line) ? 'row-duplicate' : '')}
            columns={[
              { title: 'Date', dataIndex: 'bookedAt', width: 110, render: (d: string) => formatDate(d) },
              { title: 'Libellé', dataIndex: 'rawLabel', ellipsis: true },
              { title: 'Catégorie', dataIndex: 'categoryName', width: 150, render: (c: string | null) => c ?? <span className="muted">—</span> },
              {
                title: 'Montant',
                dataIndex: 'amount',
                width: 120,
                align: 'right',
                render: (n: number) => <span className={`num${n > 0 ? ' positive' : ''}`}>{n > 0 ? '+' : ''}{formatEuro(n)}</span>,
              },
            ]}
          />
        </>
      )}
    </Modal>
  );
}
