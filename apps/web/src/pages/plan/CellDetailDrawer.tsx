/** Détail d'une cellule du plan (« Ventes · nov. 26 »). */
import { useEffect, useState } from 'react';
import { Button, Drawer, Input, Progress, Tabs } from 'antd';
import { MessageOutlined } from '@ant-design/icons';
import {
  formatDate,
  formatEuro,
  formatEuroRounded,
  formatMonthShort,
  monthOf,
  parseCellInput,
  UNCATEGORIZED_IN,
  type MonthKey,
  type PlanCell,
} from '@optimum/treso-engine';
import { useStore } from '../../store/useStore';

interface Props {
  target: { rowId: string; month: MonthKey } | null;
  cell: PlanCell | undefined;
  scenarioId: string;
  current: MonthKey;
  mayEdit: boolean;
  note: string | null;
  onClose: () => void;
  onEditNote: () => void;
}

export function CellDetailDrawer({ target, cell, scenarioId, current, mayEdit, note, onClose, onEditNote }: Props) {
  const categories = useStore((s) => s.categories);
  const transactions = useStore((s) => s.transactions);
  const commitments = useStore((s) => s.commitments);
  const today = useStore((s) => s.today);
  const forecastMode = useStore((s) => s.settings.forecastMode);
  const setBudget = useStore((s) => s.setBudget);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setText(cell?.ownBudget === null || cell?.ownBudget === undefined ? '' : String(cell.ownBudget).replace('.', ','));
    setError(null);
  }, [cell?.ownBudget, target?.rowId, target?.month, scenarioId]);

  const category = target ? categories.find((c) => c.id === target.rowId) : undefined;
  const name = target ? (category?.name ?? 'À catégoriser') : '';
  const ids = new Set<string>();
  if (category) {
    const walk = (id: string) => {
      ids.add(id);
      for (const k of categories) if (k.parentId === id) walk(k.id);
    };
    walk(category.id);
  }
  const tx = target
    ? transactions.filter(
        (t) =>
          !t.isSplit &&
          !t.hidden &&
          monthOf(t.bookedAt) === target.month &&
          (category ? t.categoryId !== null && ids.has(t.categoryId) : !t.categoryId && (target.rowId === UNCATEGORIZED_IN ? t.amount > 0 : t.amount < 0)),
      )
    : [];
  const inv = target
    ? commitments.filter(
        (c) =>
          c.status === 'pending' &&
          (category ? c.categoryId !== null && ids.has(c.categoryId) : !c.categoryId && (target.rowId === UNCATEGORIZED_IN) === (c.flow === 'in')) &&
          (monthOf(c.dueAt) === target.month || (c.dueAt < today && target.month === current)),
      )
    : [];

  const commit = () => {
    if (!target || !cell) return;
    const r = parseCellInput(text);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setError(null);
    if (r.value !== cell.ownBudget) setBudget(scenarioId, target.rowId, target.month, r.value);
  };

  const pct = cell && cell.budget > 0 ? Math.round((cell.actual / cell.budget) * 100) : null;

  return (
    <Drawer open={target !== null} onClose={onClose} width={480} title={target ? `${name} · ${formatMonthShort(target.month)}` : ''}>
      {target && cell && (
        <div className="stack">
          <div>
            <p className="detail-lead">
              <strong className="num">{formatEuroRounded(cell.actual)}</strong> réalisés
              {cell.budget > 0 && (
                <>
                  {' '}
                  sur <strong className="num">{formatEuroRounded(cell.budget)}</strong> prévus ({pct} %)
                </>
              )}
            </p>
            {pct !== null && <Progress percent={Math.min(100, pct)} showInfo={false} strokeColor={pct > 100 ? 'var(--opt-warning)' : 'var(--opt-petrol)'} size="small" />}
          </div>
          <dl className="detail-list">
            <dt>Réalisé</dt>
            <dd className="num">{formatEuro(cell.actual)}</dd>
            <dt>Engagé</dt>
            <dd className="num">{formatEuro(cell.committed)}</dd>
            <dt>Budget</dt>
            <dd>
              {cell.editable && mayEdit ? (
                <Input
                  className="num detail-budget"
                  value={text}
                  status={error ? 'error' : undefined}
                  placeholder={cell.budget > 0 ? formatEuroRounded(cell.budget) : '0'}
                  suffix="€"
                  onChange={(e) => setText(e.target.value)}
                  onBlur={commit}
                  onPressEnter={commit}
                  aria-label="Budget du mois"
                  aria-invalid={!!error}
                />
              ) : (
                <span className="num">{formatEuro(cell.budget)}</span>
              )}
              {error && <span className="field-error">{error}</span>}
            </dd>
            <dt>{forecastMode === 'projection' ? 'Projection' : 'Prévision'}</dt>
            <dd className="num">{formatEuro(cell.forecast)}</dd>
          </dl>

          <div className="detail-note">
            {note ? (
              <>
                <p>
                  <MessageOutlined /> {note}
                </p>
                {mayEdit && (
                  <Button size="small" onClick={onEditNote}>
                    Modifier le commentaire
                  </Button>
                )}
              </>
            ) : (
              mayEdit && (
                <Button icon={<MessageOutlined />} onClick={onEditNote}>
                  Ajouter un commentaire
                </Button>
              )
            )}
          </div>

          <Tabs
            items={[
              {
                key: 'tx',
                label: `Opérations (${tx.length})`,
                children: (
                  <ul className="detail-items">
                    {tx.map((t) => (
                      <li key={t.id}>
                        <span className="muted">{formatDate(t.bookedAt, false)}</span>
                        <span className="ellipsis">{t.counterparty ?? t.label}</span>
                        <span className={`num ${t.amount > 0 ? 'positive' : ''}`}>{formatEuro(t.amount)}</span>
                      </li>
                    ))}
                    {tx.length === 0 && <li className="muted">Aucune opération ce mois-ci.</li>}
                  </ul>
                ),
              },
              {
                key: 'inv',
                label: `Factures (${inv.length})`,
                children: (
                  <ul className="detail-items">
                    {inv.map((c) => (
                      <li key={c.id}>
                        <span className="muted">{formatDate(c.dueAt, false)}</span>
                        <span className="ellipsis">
                          {c.counterparty}
                          {c.number ? ` · ${c.number}` : ''}
                          {c.dueAt < today ? ' · en retard' : ''}
                        </span>
                        <span className="num">{formatEuro(c.amountInclTax - (c.amountPaid ?? 0))}</span>
                      </li>
                    ))}
                    {inv.length === 0 && <li className="muted">Aucune facture à venir.</li>}
                  </ul>
                ),
              },
            ]}
          />
        </div>
      )}
    </Drawer>
  );
}
