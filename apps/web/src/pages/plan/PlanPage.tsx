/**
 * Plan de trésorerie (écran 7.4) : scénarios, période, comptes, graphique,
 * grille éditable comme un tableur, comparaison et assistant prévisionnel.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { App, Button, Dropdown, Segmented, Select, Switch, Tooltip, type MenuProps } from 'antd';
import {
  BulbOutlined,
  CheckOutlined,
  DownloadOutlined,
  ExportOutlined,
  EditOutlined,
  LoadingOutlined,
  MoreOutlined,
  PlusOutlined,
  UndoOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import {
  computeVatSchedule,
  formatEuroRounded,
  formatMonthShort,
  increaseUntil,
  monthDiff,
  periodMonths,
  presetPeriod,
  validatePeriod,
  repeatBudget,
  vatBudgets,
  type Budget,
  type MonthKey,
  type Period,
  type PeriodPreset,
  type Scenario,
} from '@optimum/treso-engine';
import { useStore } from '../../store/useStore';
import { canEditScenarios, canWrite } from '../../api/types';
import { useCurrentBalance, useCurrentMonth, useIndicatorExprs, usePlan } from '../../store/selectors';
import { ChartLegend, TrajectoryChart } from '../../components/TrajectoryChart';
import { PlanGrid, type CellAction } from './PlanGrid';
import { IncreaseModal, NoteModal, RepeatModal } from './CellDialogs';
import { ScenarioDrawer } from './ScenarioDrawer';
import { CumulModal, PeriodSelect } from './PeriodControls';
import { ComparisonView } from './ComparisonView';
import { ForecastAssistant } from './ForecastAssistant';
import { CellDetailDrawer } from './CellDetailDrawer';
import { SCENARIO_COLORS } from './format';
import { ExportDrawer } from '../../exports/ExportDrawer';
import { BudgetImportModal } from '../../exports/BudgetImportModal';
import '../plan.css';

type CellTarget = { rowId: string; month: MonthKey };
type Dialog = { kind: 'repeat' | 'increase' | 'note'; target: CellTarget } | null;

interface SavedView {
  preset?: PeriodPreset;
  custom?: Period | null;
  display?: 'both' | 'grid';
}
const VIEW_KEY = 'treso-plan-view';
function readView(): SavedView {
  try {
    return JSON.parse(localStorage.getItem(VIEW_KEY) ?? '{}') as SavedView;
  } catch {
    return {};
  }
}
function writeView(v: SavedView) {
  try {
    localStorage.setItem(VIEW_KEY, JSON.stringify(v));
  } catch {
    /* stockage indisponible : sans conséquence */
  }
}

const isTyping = (el: EventTarget | null) => {
  const t = el as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
};

export function PlanPage() {
  const { message, modal } = App.useApp();
  const current = useCurrentMonth();
  const balance = useCurrentBalance();
  const store = useStore();
  const { categories, scenarios, settings, accounts, budgets, budgetNotes, company } = store;

  // ───── Période, cumul, comptes, affichage ─────
  // Période et affichage mémorisés dans ce navigateur (confort personnel)
  const saved = useMemo(() => readView(), []);
  const [preset, setPreset] = useState<PeriodPreset>(saved.preset ?? 'rolling');
  const [custom, setCustom] = useState<Period | null>(saved.custom ?? null);
  const period = useMemo<Period>(
    () => (preset === 'custom' && custom && !validatePeriod(custom) ? custom : presetPeriod(preset === 'custom' ? 'rolling' : preset, current, settings.fiscalYearStartMonth)),
    [preset, custom, current, settings.fiscalYearStartMonth],
  );
  const [cumul, setCumul] = useState<Period | null>(null);
  const [cumulOpen, setCumulOpen] = useState(false);
  const [accountIds, setAccountIds] = useState<string[] | null>(null);
  const [display, setDisplay] = useState<'both' | 'grid'>(saved.display ?? 'both');
  useEffect(() => writeView({ preset, custom, display }), [preset, custom, display]);
  const [highlight, setHighlight] = useState<MonthKey | null>(null);

  const months = useMemo(() => periodMonths(period), [period]);
  const totalPeriod = cumul ?? period;
  const totalMonths = useMemo(() => periodMonths(totalPeriod), [totalPeriod]);
  const from = totalPeriod.from < period.from ? totalPeriod.from : period.from;
  const to = totalPeriod.to > period.to ? totalPeriod.to : period.to;
  const plan = usePlan(from, monthDiff(from, to) + 1, accountIds);
  const indicators = useIndicatorExprs();

  // ───── Scénarios ─────
  const visibleScenarios = scenarios.filter((s) => !s.archived);
  const archived = scenarios.filter((s) => s.archived);
  const base = scenarios.find((s) => s.isBase)!;
  const [scenarioId, setScenarioId] = useState(base.id);
  const scenario = visibleScenarios.find((s) => s.id === scenarioId) ?? base;
  const [compare, setCompare] = useState(false);
  const [compareIds, setCompareIds] = useState<string[]>(() => visibleScenarios.map((s) => s.id));
  const [drawer, setDrawer] = useState<{ open: boolean; scenario: Scenario | null }>({ open: false, scenario: null });
  const altCount = scenarios.filter((s) => !s.isBase).length;
  const limitReached = company?.plan === 'ESSENTIAL' && altCount >= 1;

  // ───── Droits et édition ─────
  const mayEdit = scenario.isBase ? canWrite(store.role) : canEditScenarios(store.role);
  const mayCreateScenario = canEditScenarios(store.role);
  const [editing, setEditing] = useState(false);
  const [editPast, setEditPast] = useState(false);
  const [detail, setDetail] = useState<CellTarget | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [assistant, setAssistant] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const sp = plan.scenarios[scenario.id]!;
  const notes = useMemo(
    () => new Map(budgetNotes.filter((n) => n.scenarioId === scenario.id).map((n) => [`${n.categoryId}|${n.month}`, n.note])),
    [budgetNotes, scenario.id],
  );
  const hasFutureBudgets = useMemo(() => budgets.some((b) => b.scenarioId === base.id && b.month >= current), [budgets, base.id, current]);

  const commit = useCallback((changes: Budget[]) => store.applyBudgets(changes), [store]);
  const openDetail = useCallback((rowId: string, month: MonthKey) => setDetail({ rowId, month }), []);

  // Raccourcis : E bascule l'édition, Ctrl/⌘ Z annule la dernière saisie
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || document.querySelector('.ant-modal-wrap, .ant-drawer-open')) return;
      if ((e.key === 'e' || e.key === 'E') && !e.ctrlKey && !e.metaKey && !e.altKey && mayEdit && !compare) {
        e.preventDefault();
        setEditing((v) => !v);
      } else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        const n = useStore.getState().undoBudgets();
        if (n) message.info(n > 1 ? `Saisie annulée (${n} cellules)` : 'Saisie annulée');
        else message.info('Rien à annuler');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mayEdit, compare, message]);

  const catName = (id: string) => categories.find((c) => c.id === id)?.name ?? 'À catégoriser';
  const lastMonth = months[months.length - 1]!;

  const onCellAction = useCallback(
    (action: CellAction, rowId: string, month: MonthKey) => {
      if (action === 'detail') setDetail({ rowId, month });
      else if (action === 'base') store.applyBudgets([{ scenarioId: scenario.id, categoryId: rowId, month, amount: null }]);
      else setDialog({ kind: action, target: { rowId, month } });
    },
    [store, scenario.id],
  );

  const computeVat = () => {
    const vat = categories.find((c) => c.isVat);
    if (!vat) {
      message.warning('Aucune catégorie TVA : créez-la dans Paramètres › Catégories.');
      return;
    }
    const future = plan.months.filter((m) => m >= current);
    const schedule = computeVatSchedule(categories, plan.months, settings.vatRegime, (c, m) => {
      const cell = sp.rows[c]?.[m];
      return cell ? (m < current ? cell.actual : cell.forecast) : 0;
    });
    const changes = vatBudgets(scenario.id, vat.id, future, schedule);
    const total = changes.reduce((s, b) => s + (b.amount ?? 0), 0);
    modal.confirm({
      title: 'Calculer la TVA',
      content: (
        <>
          <p>
            Régime {settings.vatRegime === 'monthly' ? 'mensuel' : 'trimestriel'} : {formatEuroRounded(total)} à verser de {formatMonthShort(future[0]!)} à{' '}
            {formatMonthShort(future[future.length - 1]!)}, calculés sur vos prévisions TTC.
          </p>
          <p className="muted">Les budgets de la ligne TVA sur ces mois sont remplacés. Estimation à valider avec votre expert-comptable.</p>
        </>
      ),
      okText: 'Écrire la TVA dans le plan',
      cancelText: 'Annuler',
      onOk: () => {
        store.applyBudgets(changes);
        message.success('TVA estimée écrite dans le plan');
      },
    });
  };

  const scenarioMenu = (s: Scenario): MenuProps => ({
    items: [
      { key: 'edit', label: 'Renommer et décrire…' },
      ...(s.isBase
        ? []
        : [
            {
              key: 'color',
              label: 'Couleur',
              children: SCENARIO_COLORS.map((c) => ({
                key: `color:${c.value}`,
                label: (
                  <span className="compare-opt">
                    <span className="scenario-dot" style={{ background: c.value }} /> {c.label}
                  </span>
                ),
              })),
            },
          ]),
      { key: 'duplicate', label: 'Dupliquer', disabled: limitReached },
      { key: 'compare', label: 'Comparer les scénarios' },
      ...(s.isBase ? [] : [{ type: 'divider' as const }, { key: 'archive', label: 'Archiver' }, { key: 'delete', label: 'Supprimer', danger: true }]),
    ],
    onClick: async ({ key }) => {
      try {
        if (key === 'edit') setDrawer({ open: true, scenario: s });
        else if (key.startsWith('color:')) await store.updateScenario(s.id, { color: key.slice(6) });
        else if (key === 'duplicate') {
          const used = new Set(scenarios.map((x) => x.color));
          const color = (SCENARIO_COLORS.find((c) => !used.has(c.value)) ?? SCENARIO_COLORS[0]!).value;
          const id = await store.addScenario(`${s.name} (copie)`, color, s.id, s.description ?? undefined);
          setScenarioId(id);
          message.success('Scénario dupliqué');
        } else if (key === 'compare') {
          setCompareIds((ids) => [...new Set([base.id, ...ids, s.id])]);
          setCompare(true);
          setEditing(false);
        } else if (key === 'archive') {
          await store.updateScenario(s.id, { archived: true });
          setScenarioId(base.id);
          message.success(`« ${s.name} » archivé. Retrouvez-le dans le menu Scénarios archivés.`);
        } else if (key === 'delete') {
          modal.confirm({
            title: `Supprimer « ${s.name} » ?`,
            content: 'Ses budgets et commentaires sont supprimés définitivement. Pour le mettre de côté, archivez-le plutôt.',
            okText: 'Supprimer',
            okButtonProps: { danger: true },
            cancelText: 'Annuler',
            onOk: () => {
              store.removeScenario(s.id);
              setScenarioId(base.id);
            },
          });
        }
      } catch (e) {
        message.error(e instanceof Error ? e.message : 'Action impossible.');
      }
    },
  });

  const lowest = months
    .filter((m) => m >= current)
    .reduce<MonthKey | null>((lo, m) => (lo === null || sp.closing[m]! < sp.closing[lo]! ? m : lo), null);
  const chartScenarios = compare ? visibleScenarios.filter((s) => compareIds.includes(s.id)) : [scenario];
  const dialogCell = dialog ? sp.rows[dialog.target.rowId]?.[dialog.target.month] : undefined;
  const saveState = store.budgetSave;

  return (
    <>
      <div className="plan-toolbar">
        <div role="tablist" aria-label="Scénarios" className="scenario-tabs">
          {visibleScenarios.map((s) => {
            const isActive = s.id === scenario.id && !compare;
            return (
              <span key={s.id} className={`scenario-tab-wrap${isActive ? ' active' : ''}`}>
                <button
                  role="tab"
                  type="button"
                  aria-selected={isActive}
                  className={`scenario-tab${isActive ? ' active' : ''}`}
                  onClick={() => {
                    setScenarioId(s.id);
                    setCompare(false);
                  }}
                  title={s.description ?? undefined}
                >
                  <span className="scenario-dot" style={{ background: isActive ? '#fff' : s.isBase ? 'var(--opt-petrol)' : s.color }} />
                  {s.name}
                </button>
                {isActive && mayCreateScenario && (
                  <Dropdown menu={scenarioMenu(s)} trigger={['click']}>
                    <button type="button" className="scenario-more" aria-label={`Actions du scénario ${s.name}`}>
                      <MoreOutlined />
                    </button>
                  </Dropdown>
                )}
              </span>
            );
          })}
          <button
            type="button"
            role="tab"
            aria-selected={compare}
            className={`scenario-tab${compare ? ' active' : ''}`}
            onClick={() => {
              setCompare(true);
              setEditing(false);
            }}
            disabled={visibleScenarios.length < 2}
            title={visibleScenarios.length < 2 ? 'Créez un scénario alternatif pour comparer' : undefined}
          >
            Comparer
          </button>
          {mayCreateScenario && (
            <Tooltip title={limitReached ? 'Votre offre inclut 1 scénario alternatif.' : undefined}>
              <button type="button" className="scenario-add" onClick={() => setDrawer({ open: true, scenario: null })}>
                <PlusOutlined /> Scénario
              </button>
            </Tooltip>
          )}
          {archived.length > 0 && (
            <Dropdown
              trigger={['click']}
              menu={{
                items: archived.map((s) => ({ key: s.id, label: `Restaurer « ${s.name} »` })),
                onClick: async ({ key }) => {
                  await store.updateScenario(key, { archived: false });
                  setScenarioId(key);
                  message.success('Scénario restauré');
                },
              }}
            >
              <button type="button" className="scenario-add muted-btn">
                Archivés ({archived.length})
              </button>
            </Dropdown>
          )}
        </div>
      </div>

      <div className="plan-toolbar">
        <PeriodSelect
          preset={preset}
          period={period}
          onChange={(p, c) => {
            setPreset(p);
            if (c) setCustom(c);
          }}
        />
        <Select
          mode="multiple"
          allowClear
          maxTagCount="responsive"
          placeholder="Tous les comptes actifs"
          value={accountIds ?? []}
          onChange={(v: string[]) => setAccountIds(v.length ? v : null)}
          options={accounts.map((a) => ({ value: a.id, label: a.displayName || a.name }))}
          style={{ minWidth: 220, maxWidth: 360 }}
          aria-label="Comptes"
        />
        <Segmented
          value={display}
          onChange={(v) => setDisplay(v as 'both' | 'grid')}
          options={[
            { value: 'both', label: 'Graphique + grille' },
            { value: 'grid', label: 'Grille seule' },
          ]}
        />
        <Segmented
          value={settings.forecastMode}
          onChange={(v) => store.setForecastMode(v as 'budget' | 'projection')}
          options={[
            { value: 'budget', label: 'Budget' },
            { value: 'projection', label: 'Projection' },
          ]}
        />
        <div className="spacer" />
        {editing && (
          <>
            <span className={`save-state ${saveState}`} role="status" aria-live="polite">
              {saveState === 'saving' && (
                <>
                  <LoadingOutlined /> Enregistrement…
                </>
              )}
              {saveState === 'saved' && (
                <>
                  <CheckOutlined /> Enregistré
                </>
              )}
              {saveState === 'error' && (
                <>
                  <WarningOutlined /> Non enregistré
                </>
              )}
            </span>
            <Tooltip title="Annuler la dernière saisie (Ctrl/⌘ Z)">
              <Button
                icon={<UndoOutlined />}
                disabled={store.budgetHistory.length === 0}
                onClick={() => store.undoBudgets()}
                aria-label="Annuler la dernière saisie"
              />
            </Tooltip>
            <label className="switch-label">
              <Switch size="small" checked={editPast} onChange={setEditPast} /> Inclure les mois passés
            </label>
          </>
        )}
        <Button icon={<ExportOutlined />} onClick={() => setExportOpen(true)}>
          Exporter
        </Button>
        {mayEdit && !compare && (
          <Tooltip title="Importer des budgets depuis Excel ou CSV">
            <Button icon={<DownloadOutlined />} onClick={() => setImportOpen(true)}>
              Importer
            </Button>
          </Tooltip>
        )}
        {mayEdit && !compare && (
          <Button icon={<BulbOutlined />} onClick={() => setAssistant(true)}>
            Assistant
          </Button>
        )}
        {compare ? null : mayEdit ? (
          <Tooltip title="Raccourci : touche E">
            <Button type="primary" className={editing ? 'cta-orange' : undefined} icon={editing ? <CheckOutlined /> : <EditOutlined />} onClick={() => setEditing((e) => !e)}>
              {editing ? 'Terminer' : 'Modifier les budgets'}
            </Button>
          </Tooltip>
        ) : (
          <span className="muted">Consultation seule</span>
        )}
      </div>

      {!hasFutureBudgets && mayEdit && !compare && (
        <section className="card assistant-banner">
          <div>
            <h2>Construisez votre prévisionnel en 4 étapes</h2>
            <p className="muted">Partez de votre historique, ajoutez une croissance et vos événements (recrutement, emprunt…) : l’assistant remplit le plan pour vous.</p>
          </div>
          <Button type="primary" icon={<BulbOutlined />} onClick={() => setAssistant(true)}>
            Lancer l’assistant
          </Button>
        </section>
      )}

      {display === 'both' && (
        <section className="card plan-chart">
          <div className="plan-chart-summary">
            <span className="eyebrow">Solde aujourd’hui</span>
            <span className="kpi-value num">{formatEuroRounded(accountIds ? accounts.filter((a) => accountIds.includes(a.id)).reduce((s, a) => s + a.balance, 0) : balance)}</span>
            {lowest && (
              <span className={sp.closing[lowest]! < settings.minCashThreshold ? 'warn-text' : 'muted'}>
                Point bas : {formatEuroRounded(sp.closing[lowest]!)} fin {formatMonthShort(lowest)}
              </span>
            )}
            <span className="muted">
              Fin {formatMonthShort(lastMonth)} : {formatEuroRounded(sp.closing[lastMonth]!)}
            </span>
          </div>
          <div className="plan-chart-graph">
            <TrajectoryChart plan={plan} months={months} scenarios={chartScenarios} threshold={settings.minCashThreshold} height={220} showBars={!compare} onHoverMonth={setHighlight} />
            <ChartLegend scenarios={chartScenarios} showBars={!compare} />
          </div>
        </section>
      )}

      {editing && (
        <p className="edit-hint" role="status">
          Cliquez une cellule puis tapez un montant ou une formule (=8500*1,05). Entrée, Tab ou flèches pour valider, Échap pour annuler, Suppr pour effacer.
          Collez une plage copiée depuis Excel avec Ctrl/⌘ V, glissez la poignée pour recopier vers la droite, clic droit pour répéter.
          {!scenario.isBase && ' Les cellules grisées reprennent la valeur du scénario de base.'}
        </p>
      )}

      {compare ? (
        <ComparisonView
          plan={plan}
          months={months}
          scenarios={visibleScenarios}
          selected={[...new Set([base.id, ...compareIds])]}
          current={current}
          threshold={settings.minCashThreshold}
          highlightMonth={highlight}
          onSelect={(ids) => setCompareIds([...new Set([base.id, ...ids])])}
        />
      ) : (
        <PlanGrid
          plan={plan}
          months={months}
          totalMonths={totalMonths}
          scenario={scenario}
          categories={categories}
          editing={editing}
          mayEdit={mayEdit}
          editPast={editPast}
          current={current}
          threshold={settings.minCashThreshold}
          indicators={indicators}
          notes={notes}
          highlightMonth={highlight}
          onCommit={commit}
          onOpenDetail={openDetail}
          onCellAction={onCellAction}
          onVat={computeVat}
          onCustomizeTotal={() => setCumulOpen(true)}
        />
      )}
      <p className="muted">
        Montants TTC en euros, arrondis à l’euro.{' '}
        {settings.forecastMode === 'projection' ? 'Mode Projection : budgets ajustés des dépassements déjà constatés.' : 'Mode Budget : budgets tels que saisis.'}{' '}
        {settings.overdueInPlan === 'current_month' ? 'Les factures en retard sont reportées au mois courant (icône horloge).' : 'Les factures en retard restent dans leur mois d’échéance.'}
      </p>

      <CellDetailDrawer
        target={detail}
        cell={detail ? sp.rows[detail.rowId]?.[detail.month] : undefined}
        scenarioId={scenario.id}
        current={current}
        mayEdit={mayEdit}
        note={detail ? (notes.get(`${detail.rowId}|${detail.month}`) ?? null) : null}
        onClose={() => setDetail(null)}
        onEditNote={() => detail && setDialog({ kind: 'note', target: detail })}
      />

      <RepeatModal
        open={dialog?.kind === 'repeat'}
        categoryName={dialog ? catName(dialog.target.rowId) : ''}
        month={dialog?.target.month ?? current}
        amount={dialogCell ? (dialogCell.ownBudget ?? dialogCell.budget) : 0}
        lastMonth={lastMonth}
        onCancel={() => setDialog(null)}
        onConfirm={(every, duration) => {
          if (!dialog || !dialogCell) return;
          store.applyBudgets(repeatBudget(scenario.id, dialog.target.rowId, dialog.target.month, dialogCell.ownBudget ?? dialogCell.budget, every, duration));
          message.success('Valeur répétée');
          setDialog(null);
        }}
      />
      <IncreaseModal
        open={dialog?.kind === 'increase'}
        categoryName={dialog ? catName(dialog.target.rowId) : ''}
        month={dialog?.target.month ?? current}
        lastMonth={lastMonth}
        onCancel={() => setDialog(null)}
        onConfirm={(pct) => {
          if (!dialog) return;
          const row = sp.rows[dialog.target.rowId]!;
          store.applyBudgets(increaseUntil(scenario.id, dialog.target.rowId, months, dialog.target.month, pct, (m) => row[m]?.budget ?? 0));
          message.success(`Valeurs augmentées de ${pct.toLocaleString('fr-FR')} %`);
          setDialog(null);
        }}
      />
      <NoteModal
        open={dialog?.kind === 'note'}
        title={dialog ? `Commentaire · ${catName(dialog.target.rowId)} · ${formatMonthShort(dialog.target.month)}` : ''}
        initial={dialog ? (notes.get(`${dialog.target.rowId}|${dialog.target.month}`) ?? '') : ''}
        readOnly={!mayEdit}
        onCancel={() => setDialog(null)}
        onSave={async (note) => {
          if (!dialog) return;
          await store.setBudgetNote(scenario.id, dialog.target.rowId, dialog.target.month, note);
          message.success(note ? 'Commentaire enregistré' : 'Commentaire supprimé');
          setDialog(null);
        }}
      />

      <ScenarioDrawer
        open={drawer.open}
        scenario={drawer.scenario}
        scenarios={scenarios}
        limitReached={limitReached}
        onClose={() => setDrawer({ open: false, scenario: null })}
        onCreated={(id) => {
          setDrawer({ open: false, scenario: null });
          setScenarioId(id);
          setCompare(false);
          setEditing(true);
        }}
      />
      <CumulModal
        open={cumulOpen}
        value={totalPeriod}
        displayed={period}
        onCancel={() => setCumulOpen(false)}
        onApply={(p) => {
          setCumul(p);
          setCumulOpen(false);
        }}
      />
      <ExportDrawer
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        defaults={{ from: period.from, to: period.to, contents: ['plan'], scenarioIds: compare ? compareIds : [scenario.id] }}
      />
      <BudgetImportModal open={importOpen} scenarioId={scenario.id} onClose={() => setImportOpen(false)} />
      <ForecastAssistant
        open={assistant}
        currentMonth={current}
        baseScenarioId={base.id}
        canCreateScenario={mayCreateScenario && !limitReached}
        onClose={() => setAssistant(false)}
        onApplied={(id) => {
          setAssistant(false);
          setScenarioId(id);
          setCompare(false);
        }}
      />
    </>
  );
}
