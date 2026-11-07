/**
 * Grille du plan de trésorerie (écran 7.4). Hors édition, un clic ouvre le
 * détail de la cellule. En mode « Modifier les budgets », la grille se pilote
 * comme un tableur : flèches, Tab, Entrée, Échap, saisie directe, formules,
 * copier-coller d'une plage Excel, poignée de recopie, Suppr.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { App, Button, Dropdown, Tooltip, type MenuProps } from 'antd';
import { CalculatorOutlined, CaretDownOutlined, CaretRightOutlined, ClockCircleOutlined, WarningOutlined } from '@ant-design/icons';
import {
  displayValue,
  fillRight,
  formatEuroRounded,
  formatMonthShort,
  formatPlanAmount,
  formatSigned,
  gridToClipboard,
  indicatorValue,
  parseCellInput,
  parsePastedGrid,
  pasteToBudgets,
  UNCATEGORIZED_IN,
  UNCATEGORIZED_OUT,
  type Budget,
  type Category,
  type Flow,
  type MonthKey,
  type PlanCell,
  type PlanResult,
  type Scenario,
} from '@optimum/treso-engine';
import { flattenTree, type IndicatorExpr } from '../../store/selectors';
import { DecisionDot } from '../../layout/Brand';
import { formatIndicatorValue } from './format';

export type CellAction = 'repeat' | 'increase' | 'base' | 'note' | 'detail';

interface Props {
  plan: PlanResult;
  months: MonthKey[];
  totalMonths: MonthKey[];
  scenario: Scenario;
  categories: Category[];
  editing: boolean;
  mayEdit: boolean;
  editPast: boolean;
  current: MonthKey;
  threshold: number;
  indicators: IndicatorExpr[];
  /** Commentaires du scénario affiché, clé `catégorie|mois`. */
  notes: Map<string, string>;
  highlightMonth: MonthKey | null;
  onCommit: (changes: Budget[]) => void;
  onOpenDetail: (rowId: string, month: MonthKey) => void;
  onCellAction: (action: CellAction, rowId: string, month: MonthKey) => void;
  onVat: () => void;
  onCustomizeTotal: () => void;
}

interface Pos {
  r: number;
  c: number;
}

interface EditState {
  text: string;
  /** Saisie commencée en tapant : les flèches valident et déplacent. */
  quick: boolean;
  error: string | null;
}

interface Row {
  id: string;
  name: string;
  depth: number;
  hasChildren: boolean;
  isVat: boolean;
  italic?: boolean;
}

const key = (rowId: string, m: MonthKey) => `${rowId}|${m}`;

export function PlanGrid(props: Props) {
  const { plan, months, totalMonths, scenario, categories, editing, mayEdit, editPast, current, threshold, indicators, notes, highlightMonth } = props;
  const { message } = App.useApp();
  const sp = plan.scenarios[scenario.id]!;
  const base = plan.scenarios[plan.baseScenarioId]!;
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [active, setActive] = useState<Pos | null>(null);
  const [anchor, setAnchor] = useState<Pos | null>(null);
  const [edit, setEdit] = useState<EditState | null>(null);
  const [fill, setFill] = useState<{ r: number; from: number; to: number } | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; rowId: string; month: MonthKey } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  /** Colonne de départ d'une série de Tab : Entrée y revient, une ligne plus bas (comme Excel). */
  const tabOrigin = useRef<number | null>(null);

  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Lignes visibles, dans l'ordre d'affichage
  const flowRows = useCallback(
    (flow: Flow): Row[] => {
      if (collapsed.has(`total-${flow}`)) return [];
      const hiddenParents = new Set<string>();
      const rows: Row[] = [];
      for (const r of flattenTree(categories, flow)) {
        if (r.category.parentId && (hiddenParents.has(r.category.parentId) || collapsed.has(r.category.parentId))) {
          hiddenParents.add(r.category.id);
          continue;
        }
        rows.push({ id: r.category.id, name: r.category.name, depth: r.depth + 1, hasChildren: r.hasChildren, isVat: !!r.category.isVat });
      }
      rows.push({ id: flow === 'in' ? UNCATEGORIZED_IN : UNCATEGORIZED_OUT, name: 'À catégoriser', depth: 1, hasChildren: false, isVat: false, italic: true });
      return rows;
    },
    [categories, collapsed],
  );
  const inRows = useMemo(() => flowRows('in'), [flowRows]);
  const outRows = useMemo(() => flowRows('out'), [flowRows]);

  /** Lignes saisissables (feuilles et parents à budget global), dans l'ordre de la grille. */
  const navRows = useMemo(
    () => [...inRows, ...outRows].filter((r) => sp.rows[r.id]?.[months[0]!]?.editable).map((r) => r.id),
    [inRows, outRows, sp, months],
  );
  const navIndex = useMemo(() => new Map(navRows.map((id, i) => [id, i])), [navRows]);

  const canEditCell = useCallback(
    (rowId: string, m: MonthKey) => editing && mayEdit && !!sp.rows[rowId]?.[m]?.editable && (m >= current || editPast),
    [editing, mayEdit, sp, current, editPast],
  );

  // Entrer en édition place le focus dans la grille (saisie au clavier sans souris) ; la quitter la remet au repos
  useEffect(() => {
    if (editing) {
      wrapRef.current?.focus({ preventScroll: true });
    } else {
      setActive(null);
      setAnchor(null);
      setEdit(null);
    }
  }, [editing]);

  // Cellule active visible
  useEffect(() => {
    if (!active) return;
    const el = wrapRef.current?.querySelector<HTMLElement>(`td[data-r="${active.r}"][data-c="${active.c}"]`);
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [active]);

  const startEditRef = useRef<(initial: string | null, quick: boolean) => void>(() => undefined);
  const onEditChange = useCallback((text: string) => setEdit((s) => (s ? { ...s, text, error: null } : s)), []);
  const onStartEdit = useCallback(() => startEditRef.current(null, false), []);

  const focusGrid = () => requestAnimationFrame(() => wrapRef.current?.focus({ preventScroll: true }));

  const selection = useMemo(() => {
    if (!active) return null;
    const a = anchor ?? active;
    return { r1: Math.min(a.r, active.r), r2: Math.max(a.r, active.r), c1: Math.min(a.c, active.c), c2: Math.max(a.c, active.c) };
  }, [active, anchor]);

  const firstEditableCol = () => (editPast ? 0 : Math.max(0, months.findIndex((m) => m >= current)));

  const move = (dr: number, dc: number, extend = false, via: 'tab' | 'enter' | 'other' = 'other') => {
    if (!active) return;
    let col = active.c + dc;
    if (via === 'tab') {
      if (tabOrigin.current === null) tabOrigin.current = active.c;
    } else if (via === 'enter' && tabOrigin.current !== null && dr > 0) {
      col = tabOrigin.current;
      tabOrigin.current = null;
    } else {
      tabOrigin.current = null;
    }
    const next = { r: Math.max(0, Math.min(navRows.length - 1, active.r + dr)), c: Math.max(0, Math.min(months.length - 1, col)) };
    if (extend) setAnchor((a) => a ?? active);
    else setAnchor(null);
    setActive(next);
  };

  const cellAt = (p: Pos) => {
    const rowId = navRows[p.r]!;
    const month = months[p.c]!;
    return { rowId, month, cell: sp.rows[rowId]![month]! };
  };

  const startEdit = (initial: string | null, quick: boolean) => {
    if (!active) return;
    const { rowId, month, cell } = cellAt(active);
    if (!canEditCell(rowId, month)) {
      message.info(month < current ? 'Mois passé : activez « Inclure les mois passés » pour le modifier.' : 'Cette cellule se calcule à partir des sous-catégories.');
      return;
    }
    setAnchor(null);
    setEdit({ text: initial ?? (cell.ownBudget === null ? '' : String(cell.ownBudget).replace('.', ',')), quick, error: null });
  };

  startEditRef.current = startEdit;

  /** Valide la saisie en cours ; renvoie `false` si elle est invalide. */
  const commitEdit = (): boolean => {
    if (!edit || !active) return true;
    const parsed = parseCellInput(edit.text);
    if (!parsed.ok) {
      setEdit({ ...edit, error: parsed.error });
      return false;
    }
    const { rowId, month, cell } = cellAt(active);
    if (parsed.value !== cell.ownBudget) props.onCommit([{ scenarioId: scenario.id, categoryId: rowId, month, amount: parsed.value }]);
    setEdit(null);
    focusGrid();
    return true;
  };

  const clearSelection = () => {
    if (!selection) return;
    const changes: Budget[] = [];
    for (let r = selection.r1; r <= selection.r2; r++) {
      for (let c = selection.c1; c <= selection.c2; c++) {
        const { rowId, month, cell } = cellAt({ r, c });
        if (canEditCell(rowId, month) && cell.ownBudget !== null) changes.push({ scenarioId: scenario.id, categoryId: rowId, month, amount: null });
      }
    }
    props.onCommit(changes);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!editing || !active) return;
    const mod = e.ctrlKey || e.metaKey;
    if (edit) {
      if (e.key === 'Escape') {
        e.preventDefault();
        setEdit(null);
        focusGrid();
        return;
      }
      const moves: Record<string, [number, number]> = { Enter: [e.shiftKey ? -1 : 1, 0], Tab: [0, e.shiftKey ? -1 : 1] };
      if (edit.quick || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        Object.assign(moves, { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] });
      }
      const d = moves[e.key];
      if (d) {
        e.preventDefault();
        if (commitEdit()) move(d[0], d[1], false, e.key === 'Tab' ? 'tab' : e.key === 'Enter' ? 'enter' : 'other');
      }
      return;
    }
    switch (e.key) {
      case 'ArrowUp':
      case 'ArrowDown':
      case 'ArrowLeft':
      case 'ArrowRight': {
        e.preventDefault();
        const d = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[e.key] as [number, number];
        move(d[0], d[1], e.shiftKey);
        return;
      }
      case 'Tab':
        e.preventDefault();
        move(0, e.shiftKey ? -1 : 1, false, 'tab');
        return;
      case 'Home':
        e.preventDefault();
        setAnchor(null);
        setActive({ r: e.ctrlKey || e.metaKey ? 0 : active.r, c: firstEditableCol() });
        return;
      case 'End':
        e.preventDefault();
        setAnchor(null);
        setActive({ r: e.ctrlKey || e.metaKey ? navRows.length - 1 : active.r, c: months.length - 1 });
        return;
      case 'Enter':
      case 'F2':
        e.preventDefault();
        startEdit(null, false);
        return;
      case 'Delete':
      case 'Backspace':
        e.preventDefault();
        clearSelection();
        return;
      case 'Escape':
        setAnchor(null);
        return;
    }
    if (!mod && !e.altKey && e.key.length === 1 && /[0-9=,.\-+(]/.test(e.key)) {
      e.preventDefault();
      startEdit(e.key, true);
    }
  };

  const onPaste = (e: React.ClipboardEvent) => {
    if (!editing || !active || !mayEdit) return;
    const text = e.clipboardData.getData('text/plain');
    // Dans une cellule en cours de saisie, une valeur simple se colle normalement
    if (edit && !/[\t\n]/.test(text.trim())) return;
    e.preventDefault();
    setEdit(null);
    const grid = parsePastedGrid(text);
    const res = pasteToBudgets(grid, { scenarioId: scenario.id, rowIds: navRows, months, startRow: active.r, startMonth: active.c, canEdit: canEditCell });
    props.onCommit(res.changes);
    const rows = grid.length;
    const cols = Math.max(0, ...grid.map((l) => l.length));
    if (res.changes.length) {
      setAnchor({ r: Math.min(navRows.length - 1, active.r + rows - 1), c: Math.min(months.length - 1, active.c + cols - 1) });
    }
    const parts = [`${res.changes.length} cellule${res.changes.length > 1 ? 's' : ''} collée${res.changes.length > 1 ? 's' : ''}`];
    if (res.skipped) parts.push(`${res.skipped} ignorée${res.skipped > 1 ? 's' : ''} (hors grille, mois passés ou texte)`);
    (res.skipped ? message.warning : message.success)(parts.join(' · '));
    focusGrid();
  };

  const onCopy = (e: React.ClipboardEvent) => {
    if (!editing || !selection || edit) return;
    e.preventDefault();
    const values: (number | null)[][] = [];
    for (let r = selection.r1; r <= selection.r2; r++) {
      const line: (number | null)[] = [];
      for (let c = selection.c1; c <= selection.c2; c++) {
        const { month, cell } = cellAt({ r, c });
        const v = month < current && !editPast ? cell.actual : cell.budget;
        line.push(v === 0 ? null : v);
      }
      values.push(line);
    }
    e.clipboardData.setData('text/plain', gridToClipboard(values));
    const n = (selection.r2 - selection.r1 + 1) * (selection.c2 - selection.c1 + 1);
    message.success(`${n} cellule${n > 1 ? 's' : ''} copiée${n > 1 ? 's' : ''}`);
  };

  // Poignée de recopie : glisser vers la droite
  useEffect(() => {
    if (!fill) return;
    const up = () => {
      if (fill.to > fill.from) {
        const { rowId, month, cell } = cellAt({ r: fill.r, c: fill.from });
        const changes = fillRight(scenario.id, rowId, months, month, months[fill.to]!, cell.ownBudget ?? cell.budget).filter((b) => canEditCell(b.categoryId, b.month));
        props.onCommit(changes);
        setAnchor({ r: fill.r, c: fill.from });
        setActive({ r: fill.r, c: fill.to });
      }
      setFill(null);
      focusGrid();
    };
    window.addEventListener('mouseup', up, { once: true });
    return () => window.removeEventListener('mouseup', up);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fill]);

  const cellFromEvent = (target: EventTarget): { rowId: string; month: MonthKey; td: HTMLElement } | null => {
    const td = (target as HTMLElement).closest<HTMLElement>('td[data-row]');
    if (!td) return null;
    return { rowId: td.dataset.row!, month: td.dataset.month!, td };
  };

  const onMouseDown = (e: React.MouseEvent) => {
    if (!editing || e.button !== 0) return;
    if ((e.target as HTMLElement).closest('.fill-handle')) {
      e.preventDefault();
      if (active) setFill({ r: active.r, from: active.c, to: active.c });
      return;
    }
    const hit = cellFromEvent(e.target);
    if (!hit || (e.target as HTMLElement).tagName === 'INPUT') return;
    const r = navIndex.get(hit.rowId);
    if (r === undefined) return;
    const c = months.indexOf(hit.month);
    if (edit && !commitEdit()) return;
    if (e.shiftKey && active) setAnchor((a) => a ?? active);
    else setAnchor(null);
    setActive({ r, c });
    focusGrid();
  };

  const onMouseOver = (e: React.MouseEvent) => {
    if (!fill) return;
    const hit = cellFromEvent(e.target);
    if (!hit || navIndex.get(hit.rowId) !== fill.r) return;
    const c = months.indexOf(hit.month);
    if (c >= fill.from) setFill({ ...fill, to: c });
  };

  const onContextMenu = (e: React.MouseEvent) => {
    const hit = cellFromEvent(e.target);
    if (!hit || hit.rowId === UNCATEGORIZED_IN || hit.rowId === UNCATEGORIZED_OUT) return;
    e.preventDefault();
    if (editing) {
      const r = navIndex.get(hit.rowId);
      if (r !== undefined) {
        if (edit && !commitEdit()) return;
        setAnchor(null);
        setActive({ r, c: months.indexOf(hit.month) });
      }
    }
    setMenu({ x: e.clientX, y: e.clientY, rowId: hit.rowId, month: hit.month });
  };

  const menuItems = (): MenuProps['items'] => {
    if (!menu) return [];
    const editable = mayEdit && !!sp.rows[menu.rowId]?.[menu.month]?.editable && (menu.month >= current || editPast);
    const own = sp.rows[menu.rowId]?.[menu.month]?.ownBudget;
    const hasNote = notes.has(key(menu.rowId, menu.month));
    return [
      { key: 'repeat', label: 'Répéter…', disabled: !editable },
      { key: 'increase', label: 'Augmenter de x % jusqu’à la fin de la période…', disabled: !editable },
      ...(scenario.isBase ? [] : [{ key: 'base', label: 'Revenir à la valeur de base', disabled: !editable || own === null }]),
      { type: 'divider' as const },
      { key: 'note', label: hasNote ? 'Modifier le commentaire' : 'Ajouter un commentaire', disabled: !mayEdit && !hasNote },
      { key: 'detail', label: 'Voir le détail' },
    ];
  };

  const totalOf = (cells: Record<MonthKey, Pick<PlanCell, 'actual' | 'forecast'>>) =>
    totalMonths.reduce((s, m) => s + (cells[m] ? displayValue(cells[m]!, m, current) : 0), 0);

  const colClass = (m: MonthKey) => `num${m === current ? ' current' : ''}${m === highlightMonth ? ' hl' : ''}`;

  const renderCategoryRow = (row: Row) => {
    const cells = sp.rows[row.id];
    if (!cells) return null;
    const r = navIndex.get(row.id);
    return (
      <tr key={row.id} className={row.italic ? 'row-muted' : undefined}>
        <th scope="row" className="label" style={{ paddingLeft: 16 + row.depth * 20 + (row.hasChildren ? 0 : 20) }}>
          <span className="label-inner">
            {row.hasChildren && (
              <button type="button" className="chevron" aria-label={collapsed.has(row.id) ? `Déplier ${row.name}` : `Replier ${row.name}`} aria-expanded={!collapsed.has(row.id)} onClick={() => toggle(row.id)}>
                {collapsed.has(row.id) ? <CaretRightOutlined /> : <CaretDownOutlined />}
              </button>
            )}
            <span className={`label-text${row.italic ? ' italic' : ''}`}>{row.name}</span>
            {row.isVat && editing && mayEdit && (
              <Button size="small" type="link" icon={<CalculatorOutlined />} onClick={props.onVat} className="vat-btn">
                Calculer la TVA
              </Button>
            )}
          </span>
        </th>
        {months.map((m, c) => {
          const cell = cells[m]!;
          const isActive = active !== null && r === active.r && c === active.c;
          const inSel = selection !== null && r !== undefined && r >= selection.r1 && r <= selection.r2 && c >= selection.c1 && c <= selection.c2;
          const inFill = fill !== null && r === fill.r && c > fill.from && c <= fill.to;
          return (
            <GridCell
              key={m}
              rowId={row.id}
              rowName={row.name}
              month={m}
              r={r}
              c={c}
              cell={cell}
              baseBudget={base.rows[row.id]?.[m]?.budget ?? 0}
              className={colClass(m)}
              current={current}
              editing={editing}
              editable={canEditCell(row.id, m)}
              active={isActive}
              selected={inSel && !isActive}
              filling={inFill}
              edit={isActive ? edit : null}
              altColor={scenario.isBase ? null : scenario.color}
              note={notes.get(key(row.id, m)) ?? null}
              overdue={plan.overdue[row.id]?.[m] ?? 0}
              onEditChange={onEditChange}
              onStartEdit={onStartEdit}
              onOpenDetail={props.onOpenDetail}
            />
          );
        })}
        <td className="num total-col">{formatPlanAmount(totalOf(cells))}</td>
      </tr>
    );
  };

  const renderFlow = (flow: Flow, rows: Row[]) => {
    const totals = sp.totals[flow];
    const label = flow === 'in' ? 'Encaissements' : 'Décaissements';
    const k = `total-${flow}`;
    return (
      <>
        <tr className={`row-total ${flow}`}>
          <th scope="row" className="label">
            <button type="button" className="chevron" aria-expanded={!collapsed.has(k)} aria-label={collapsed.has(k) ? `Déplier ${label}` : `Replier ${label}`} onClick={() => toggle(k)}>
              {collapsed.has(k) ? <CaretRightOutlined /> : <CaretDownOutlined />}
            </button>
            {label}
          </th>
          {months.map((m) => (
            <td key={m} className={colClass(m)}>
              {m === current ? (
                <>
                  <span className="cell-actual">{formatPlanAmount(totals[m]!.actual)}</span>
                  <span className="cell-sep"> / </span>
                  {formatPlanAmount(totals[m]!.forecast)}
                </>
              ) : (
                formatPlanAmount(displayValue(totals[m]!, m, current))
              )}
            </td>
          ))}
          <td className="num total-col">{formatPlanAmount(totalOf(totals))}</td>
        </tr>
        {rows.map(renderCategoryRow)}
      </>
    );
  };

  const lastTotal = totalMonths[totalMonths.length - 1]!;
  const sumOver = (rec: Record<MonthKey, number>) => totalMonths.reduce((s, m) => s + (rec[m] ?? 0), 0);

  return (
    <div
      ref={wrapRef}
      className={`card plan-table-wrap${editing ? ' is-editing' : ''}`}
      tabIndex={editing ? 0 : -1}
      role={editing ? 'grid' : undefined}
      aria-label={editing ? 'Budgets : flèches pour se déplacer, saisissez un montant, Entrée pour valider' : undefined}
      onKeyDown={onKeyDown}
      onPaste={onPaste}
      onCopy={onCopy}
      onMouseDown={onMouseDown}
      onMouseOver={onMouseOver}
      onContextMenu={onContextMenu}
      onFocus={() => {
        if (editing && !active && navRows.length) setActive({ r: 0, c: firstEditableCol() });
      }}
    >
      <table className="plan-table">
        <thead>
          <tr>
            <th scope="col" className="label">
              <button
                type="button"
                className="link-btn"
                onClick={() => setCollapsed(collapsed.size ? new Set() : new Set(categories.filter((c) => categories.some((k) => k.parentId === c.id)).map((c) => c.id)))}
              >
                {collapsed.size ? 'Tout déplier' : 'Tout replier'}
              </button>
            </th>
            {months.map((m) => (
              <th key={m} scope="col" className={colClass(m)}>
                {m === current ? (
                  <>
                    <span className="month-current">
                      <DecisionDot size={7} /> {formatMonthShort(m)}
                    </span>
                    <span className="th-sub">réalisé / prévu</span>
                  </>
                ) : (
                  formatMonthShort(m)
                )}
              </th>
            ))}
            <th scope="col" className="num total-col">
              <button type="button" className="total-head" onClick={props.onCustomizeTotal} title="Personnaliser le cumul">
                Total
                <span className="th-sub">
                  {formatMonthShort(totalMonths[0]!)} → {formatMonthShort(lastTotal)}
                </span>
              </button>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr className="row-strong">
            <th scope="row" className="label">Solde en début de mois</th>
            {months.map((m) => (
              <td key={m} className={colClass(m)}>
                {formatPlanAmount(sp.opening[m]!)}
              </td>
            ))}
            <td className="num total-col">{formatPlanAmount(sp.opening[totalMonths[0]!] ?? 0)}</td>
          </tr>
          {renderFlow('in', inRows)}
          {renderFlow('out', outRows)}
          <tr className="row-muted">
            <th scope="row" className="label">Exclu des totaux</th>
            {months.map((m) => (
              <td key={m} className={colClass(m)}>
                {formatSigned(sp.hidden[m]!)}
              </td>
            ))}
            <td className="num total-col">{formatSigned(sumOver(sp.hidden))}</td>
          </tr>
          <tr className="row-strong">
            <th scope="row" className="label">Variation du mois</th>
            {months.map((m) => (
              <td key={m} className={`${colClass(m)} ${sp.variation[m]! > 0 ? 'pos' : ''}`}>
                {formatSigned(sp.variation[m]!)}
              </td>
            ))}
            <td className="num total-col">{formatSigned(sumOver(sp.variation))}</td>
          </tr>
          <tr className="row-closing">
            <th scope="row" className="label">Solde en fin de mois</th>
            {months.map((m) => {
              const v = sp.closing[m]!;
              const state = v < 0 ? 'negative' : v < threshold ? 'below' : '';
              return (
                <td key={m} className={`${colClass(m)} ${state}`}>
                  {state && (
                    <Tooltip title={state === 'negative' ? 'Solde négatif' : `Sous le seuil de ${formatEuroRounded(threshold)}`}>
                      <WarningOutlined aria-label={state === 'negative' ? 'Solde négatif' : 'Sous le seuil'} />{' '}
                    </Tooltip>
                  )}
                  {formatPlanAmount(v)}
                </td>
              );
            })}
            <td className="num total-col">{formatPlanAmount(sp.closing[lastTotal] ?? 0)}</td>
          </tr>
          {indicators.length > 0 && (
            <tr className="row-group">
              <th scope="row" className="label">
                <button type="button" className="chevron" aria-expanded={!collapsed.has('indicators')} onClick={() => toggle('indicators')} aria-label="Indicateurs">
                  {collapsed.has('indicators') ? <CaretRightOutlined /> : <CaretDownOutlined />}
                </button>
                Indicateurs
              </th>
              <td colSpan={months.length + 1} />
            </tr>
          )}
          {!collapsed.has('indicators') &&
            indicators.map((ind) => (
              <tr key={ind.id} className="row-indicator">
                <th scope="row" className="label" style={{ paddingLeft: 36 }}>
                  {ind.error ? <Tooltip title={ind.error}><span className="italic">{ind.name}</span></Tooltip> : ind.name}
                </th>
                {months.map((m) => (
                  <td key={m} className={colClass(m)}>
                    {formatIndicatorValue(ind, ind.expr ? indicatorValue(ind.expr, plan, scenario.id, m) : null)}
                  </td>
                ))}
                <td className="num total-col">—</td>
              </tr>
            ))}
        </tbody>
      </table>

      <Dropdown
        open={menu !== null}
        onOpenChange={(o) => !o && setMenu(null)}
        trigger={['click']}
        menu={{
          items: menuItems(),
          onClick: ({ key: k }) => {
            if (menu) props.onCellAction(k as CellAction, menu.rowId, menu.month);
            setMenu(null);
          },
        }}
      >
        <span className="ctx-anchor" style={menu ? { left: menu.x, top: menu.y } : undefined} />
      </Dropdown>
    </div>
  );
}

interface CellProps {
  rowId: string;
  rowName: string;
  month: MonthKey;
  r: number | undefined;
  c: number;
  cell: PlanCell;
  baseBudget: number;
  className: string;
  current: MonthKey;
  editing: boolean;
  editable: boolean;
  active: boolean;
  selected: boolean;
  filling: boolean;
  edit: EditState | null;
  altColor: string | null;
  note: string | null;
  overdue: number;
  onEditChange: (text: string) => void;
  onStartEdit: () => void;
  onOpenDetail: (rowId: string, month: MonthKey) => void;
}

/** Une cellule de catégorie : lecture, sélection, saisie. Mémoïsée pour garder la grille fluide. */
const GridCell = memo(function GridCell(p: CellProps) {
  const { cell, month, current } = p;
  const past = month < current;
  const classes = [p.className, 'cat-cell'];
  if (p.editing) classes.push(p.editable ? 'is-editable' : 'is-locked');
  if (p.active) classes.push('is-active');
  if (p.selected) classes.push('is-selected');
  if (p.filling) classes.push('is-filling');
  if (p.note) classes.push('has-note');
  if (p.edit?.error) classes.push('has-error');
  const altStyle = cell.isAlternative && p.altColor ? { borderBottomColor: p.altColor } : undefined;
  const label = `${p.rowName}, ${formatMonthShort(month)}`;

  let content: ReactNode;
  if (p.edit) {
    content = (
      <Tooltip open={!!p.edit.error} title={p.edit.error} placement="bottom">
        <input
          className="grid-input num"
          autoFocus
          value={p.edit.text}
          aria-label={`Budget ${label}`}
          aria-invalid={!!p.edit.error}
          onChange={(e) => p.onEditChange(e.target.value)}
          onFocus={(e) => {
            const el = e.currentTarget;
            const end = el.value.length;
            el.setSelectionRange(end, end);
          }}
        />
      </Tooltip>
    );
  } else if (p.editing && p.editable) {
    // Mode édition : on montre le budget saisi ; hérité du scénario de base = grisé
    content =
      cell.ownBudget !== null ? (
        <span className={cell.isAlternative ? 'alt' : undefined} style={altStyle}>
          {formatPlanAmount(cell.ownBudget)}
        </span>
      ) : cell.budget > 0 ? (
        <span className="inherited">{formatPlanAmount(cell.budget)}</span>
      ) : (
        <span className="empty">—</span>
      );
  } else {
    const value =
      past ? (
        formatPlanAmount(cell.actual)
      ) : month === current ? (
        <>
          <span className="cell-actual">{formatPlanAmount(cell.actual)}</span>
          <span className="cell-sep"> / </span>
          {formatPlanAmount(cell.forecast)}
        </>
      ) : (
        formatPlanAmount(cell.forecast)
      );
    const button = p.editing ? (
      <span className="cell-static">{value}</span>
    ) : (
      <button type="button" className={`cell-btn${cell.isAlternative ? ' alt' : ''}`} style={altStyle} onClick={() => p.onOpenDetail(p.rowId, month)} aria-label={`${label} : voir le détail`}>
        {value}
      </button>
    );
    content = cell.isAlternative ? <Tooltip title={`Valeur de base : ${formatEuroRounded(p.baseBudget)}`}>{button}</Tooltip> : button;
  }

  const progress = month === current && !p.edit && cell.forecast > 0 ? Math.min(100, Math.round((cell.actual / cell.forecast) * 100)) : null;

  return (
    <td
      className={classes.join(' ')}
      data-row={p.rowId}
      data-month={month}
      data-r={p.r}
      data-c={p.c}
      aria-selected={p.editing ? p.active || p.selected : undefined}
      onDoubleClick={p.editing && p.editable ? p.onStartEdit : undefined}
      title={p.note ?? undefined}
    >
      {p.overdue > 0 && !p.edit && (
        <Tooltip title={`Factures en retard reportées ce mois-ci : ${formatEuroRounded(p.overdue)}`}>
          <ClockCircleOutlined className="overdue-icon" aria-label="Factures en retard" />
        </Tooltip>
      )}
      {content}
      {progress !== null && (
        <span className="mini-progress" aria-hidden="true">
          <span style={{ width: `${progress}%` }} />
        </span>
      )}
      {p.active && !p.edit && p.editable && <span className="fill-handle" aria-hidden="true" title="Glisser pour recopier vers la droite" />}
    </td>
  );
});
