/** Importer des budgets depuis Excel ou CSV (modèle exporté ou tableau maison). */
import './exports.css';
import { useEffect, useMemo, useState } from 'react';
import { Alert, App, Button, Checkbox, Modal, Select, Upload } from 'antd';
import { DownloadOutlined, InboxOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { budgetsSheet, formatMonthShort, monthRange, parseBudgetSheet, type BudgetImportResult } from '@optimum/treso-engine';
import { useStore } from '../store/useStore';
import { downloadBlob, readMatrix } from '../components/spreadsheet';
import { writeXlsx } from './writer';

interface Props {
  open: boolean;
  scenarioId: string;
  onClose: () => void;
}

export function BudgetImportModal({ open, scenarioId, onClose }: Props) {
  const { message } = App.useApp();
  const s = useStore();
  const [target, setTarget] = useState(scenarioId);
  const [file, setFile] = useState<File | null>(null);
  const [sheets, setSheets] = useState<string[]>([]);
  const [sheet, setSheet] = useState<string | undefined>();
  const [matrix, setMatrix] = useState<unknown[][] | null>(null);
  const [clearEmpty, setClearEmpty] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTarget(scenarioId);
    setFile(null);
    setMatrix(null);
    setSheets([]);
    setSheet(undefined);
    setError(null);
    setClearEmpty(false);
  }, [open, scenarioId]);

  const load = async (f: File, sh?: string) => {
    setError(null);
    try {
      const r = await readMatrix(f, sh);
      setFile(f);
      setSheets(r.sheets);
      setSheet(r.sheet);
      setMatrix(r.matrix);
    } catch (e) {
      setMatrix(null);
      setError(e instanceof Error ? e.message : 'Fichier illisible.');
    }
  };

  const result: BudgetImportResult | null = useMemo(
    () => (matrix ? parseBudgetSheet(matrix, s.categories, target, { clearEmpty }) : null),
    [matrix, s.categories, target, clearEmpty],
  );
  const amounts = result?.changes.filter((c) => c.amount !== null).length ?? 0;

  const template = async () => {
    const sc = s.scenarios.find((x) => x.id === target)!;
    const current = dayjs(s.today).startOf('month').format('YYYY-MM-01');
    const months = monthRange(current, 12);
    const to = dayjs(months[11]).endOf('month').format('YYYY-MM-DD');
    const sheet = budgetsSheet(s.budgets, sc, { companyName: s.company?.name ?? '', categories: s.categories, accounts: s.accounts, scenarios: s.scenarios, today: s.today, months, from: current, to });
    downloadBlob(`modele-budgets-${s.today}.xlsx`, await writeXlsx([sheet], { companyName: s.company?.name ?? '', from: current, to, today: s.today }));
  };

  const apply = () => {
    if (!result) return;
    s.applyBudgets(result.changes);
    message.success(`${amounts} budget${amounts > 1 ? 's' : ''} importé${amounts > 1 ? 's' : ''}. Ctrl/⌘ Z dans le plan pour annuler.`);
    onClose();
  };

  return (
    <Modal
      open={open}
      onCancel={onClose}
      width={640}
      title="Importer des budgets"
      destroyOnHidden
      footer={[
        <Button key="c" onClick={onClose}>
          Annuler
        </Button>,
        <Button key="ok" type="primary" disabled={!result || result.changes.length === 0} onClick={apply}>
          {result && result.changes.length ? `Importer ${amounts} budget${amounts > 1 ? 's' : ''}` : 'Importer'}
        </Button>,
      ]}
    >
      <div className="budget-import">
        <p className="muted">
          Une ligne par catégorie, une colonne par mois (« janv. 2027 », « 01/2027 »…). Le plus simple : téléchargez le modèle, remplissez-le dans Excel puis déposez-le ici.
        </p>
        <div className="budget-import-row">
          <label>Scénario</label>
          <Select value={target} onChange={setTarget} style={{ minWidth: 220 }} options={s.scenarios.filter((x) => !x.archived).map((x) => ({ value: x.id, label: x.name }))} />
          <Button icon={<DownloadOutlined />} onClick={template}>
            Télécharger le modèle
          </Button>
        </div>
        <Upload.Dragger
          accept=".xlsx,.csv"
          showUploadList={false}
          beforeUpload={(f) => {
            void load(f);
            return false;
          }}
        >
          <p className="ant-upload-drag-icon">
            <InboxOutlined />
          </p>
          <p>{file ? file.name : 'Déposez votre fichier XLSX ou CSV, ou cliquez pour le choisir'}</p>
        </Upload.Dragger>
        {error && <Alert type="error" showIcon message={error} />}
        {sheets.length > 1 && (
          <div className="budget-import-row">
            <label>Onglet</label>
            <Select value={sheet} onChange={(v) => file && load(file, v)} options={sheets.map((x) => ({ value: x, label: x }))} style={{ minWidth: 220 }} />
          </div>
        )}
        {result && (
          <>
            <Checkbox checked={clearEmpty} onChange={(e) => setClearEmpty(e.target.checked)}>
              Les cellules vides effacent les budgets existants
            </Checkbox>
            {result.changes.length > 0 ? (
              <Alert
                type="success"
                showIcon
                message={`${amounts} montant${amounts > 1 ? 's' : ''} sur ${result.rows} catégorie${result.rows > 1 ? 's' : ''}, de ${formatMonthShort(result.months[0]!)} à ${formatMonthShort(result.months[result.months.length - 1]!)}.`}
                description="Les budgets existants de ces cellules sont remplacés."
              />
            ) : (
              <Alert type="warning" showIcon message="Aucun montant reconnu dans ce fichier." />
            )}
            {result.unknownCategories.length > 0 && (
              <Alert type="info" showIcon message={`Catégories inconnues, ignorées : ${result.unknownCategories.join(', ')}.`} description="Créez-les dans Paramètres ou renommez la ligne comme dans Tréso Optimum." />
            )}
            {result.errors.length > 0 && (
              <Alert
                type="warning"
                showIcon
                message={`${result.errors.length} ligne${result.errors.length > 1 ? 's' : ''} à vérifier`}
                description={
                  <ul className="import-errors">
                    {result.errors.slice(0, 8).map((e, i) => (
                      <li key={i}>{e.message}</li>
                    ))}
                  </ul>
                }
              />
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
