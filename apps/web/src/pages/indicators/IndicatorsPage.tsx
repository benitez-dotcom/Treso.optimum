/** Indicateurs personnalisés (écran 7.13). */
import { useMemo, useState } from 'react';
import { App, Button, Dropdown, Empty, Table, Tooltip } from 'antd';
import { ArrowDownOutlined, ArrowUpOutlined, DeleteOutlined, EditOutlined, PlusOutlined, AppstoreAddOutlined } from '@ant-design/icons';
import { Line, LineChart, ResponsiveContainer, Tooltip as ChartTooltip } from 'recharts';
import { addMonths, formatMonthShort, indicatorTemplates, indicatorValue } from '@optimum/treso-engine';
import { useStore } from '../../store/useStore';
import { canWrite, type Indicator } from '../../api/types';
import { useCurrentMonth, useIndicatorExprs, usePlan, type IndicatorExpr } from '../../store/selectors';
import { formatIndicatorValue } from '../plan/format';
import { FormulaView, IndicatorEditor, type IndicatorDraft } from './IndicatorEditor';
import './indicators.css';

export function IndicatorsPage() {
  const { message, modal } = App.useApp();
  const current = useCurrentMonth();
  const role = useStore((s) => s.role);
  const categories = useStore((s) => s.categories);
  const deleteIndicator = useStore((s) => s.deleteIndicator);
  const reorderIndicators = useStore((s) => s.reorderIndicators);
  const indicators = useIndicatorExprs();
  const mayEdit = canWrite(role);
  const from = addMonths(current, -5);
  const plan = usePlan(from, 12);
  const sparkMonths = plan.months;
  const previewMonths = plan.months.slice(5, 11);
  const [editor, setEditor] = useState<{ open: boolean; indicator: Indicator | null; draft: IndicatorDraft | null }>({ open: false, indicator: null, draft: null });

  const templates = useMemo(() => {
    const taken = new Set(indicators.map((i) => i.name.toLocaleLowerCase('fr')));
    return indicatorTemplates(categories).filter((t) => !taken.has(t.name.toLocaleLowerCase('fr')));
  }, [categories, indicators]);

  const move = (id: string, delta: number) => {
    const ids = indicators.map((i) => i.id);
    const i = ids.indexOf(id);
    const j = i + delta;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    void reorderIndicators(ids);
  };

  const valueAt = (ind: IndicatorExpr, m: string) => (ind.expr ? indicatorValue(ind.expr, plan, plan.baseScenarioId, m) : null);

  const templateMenu = {
    items: templates.length
      ? templates.map((t) => ({
          key: t.key,
          label: (
            <span className="template-item">
              <strong>{t.name}</strong>
              <span className="muted">{t.description}</span>
            </span>
          ),
        }))
      : [{ key: 'none', label: 'Tous les modèles disponibles sont déjà créés.', disabled: true }],
    onClick: ({ key }: { key: string }) => {
      const t = templates.find((x) => x.key === key);
      if (t) setEditor({ open: true, indicator: null, draft: { name: t.name, formula: t.formula, unit: t.unit, format: t.format, decimals: t.format === 'currency' ? 0 : 2 } });
    },
  };

  return (
    <div className="indicators-page">
      <div className="page-head">
        <div>
          <h1>Indicateurs</h1>
          <p className="muted">Vos ratios calculés chaque mois à partir du plan de trésorerie : réalisé pour les mois passés, prévu ensuite.</p>
        </div>
        {mayEdit && (
          <div className="page-actions">
            <Dropdown menu={templateMenu} trigger={['click']}>
              <Button icon={<AppstoreAddOutlined />}>Partir d’un modèle</Button>
            </Dropdown>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setEditor({ open: true, indicator: null, draft: null })}>
              Nouvel indicateur
            </Button>
          </div>
        )}
      </div>

      <section className="card indicators-card">
        {indicators.length === 0 ? (
          <Empty
            description={
              <>
                <strong>Aucun indicateur pour l’instant</strong>
                <br />
                Partez d’un modèle (marge brute, poids de la masse salariale…) ou écrivez votre formule.
              </>
            }
          />
        ) : (
          <Table<IndicatorExpr>
            rowKey="id"
            pagination={false}
            dataSource={indicators}
            columns={[
              {
                title: 'Nom',
                dataIndex: 'name',
                render: (name: string, ind) => (
                  <span className="ind-name">
                    <strong>{name}</strong>
                    {ind.error && <span className="field-error">{ind.error}</span>}
                  </span>
                ),
              },
              { title: 'Formule', dataIndex: 'formula', render: (f: string) => <FormulaView formula={f} /> },
              {
                title: `Valeur ${formatMonthShort(current)}`,
                align: 'right',
                render: (_, ind) => <span className="num ind-value">{formatIndicatorValue(ind, valueAt(ind, current))}</span>,
              },
              {
                title: 'Évolution',
                width: 160,
                render: (_, ind) => {
                  const data = sparkMonths.map((m) => ({ m: formatMonthShort(m), v: valueAt(ind, m) }));
                  return (
                    <div className="sparkline" aria-label={`Évolution de ${ind.name} sur 12 mois`}>
                      <ResponsiveContainer>
                        <LineChart data={data}>
                          <ChartTooltip
                            formatter={(v: number) => [formatIndicatorValue(ind, v), ind.name]}
                            labelFormatter={(_, p) => (p?.[0]?.payload?.m as string) ?? ''}
                            contentStyle={{ fontSize: 12, borderRadius: 6 }}
                          />
                          <Line type="monotone" dataKey="v" stroke="var(--opt-petrol)" strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  );
                },
              },
              ...(mayEdit
                ? [
                    {
                      title: '',
                      width: 170,
                      align: 'right' as const,
                      render: (_: unknown, ind: IndicatorExpr, index: number) => (
                        <span className="row-actions">
                          <Tooltip title="Monter">
                            <Button type="text" size="small" icon={<ArrowUpOutlined />} disabled={index === 0} onClick={() => move(ind.id, -1)} aria-label={`Monter ${ind.name}`} />
                          </Tooltip>
                          <Tooltip title="Descendre">
                            <Button type="text" size="small" icon={<ArrowDownOutlined />} disabled={index === indicators.length - 1} onClick={() => move(ind.id, 1)} aria-label={`Descendre ${ind.name}`} />
                          </Tooltip>
                          <Tooltip title="Modifier">
                            <Button type="text" size="small" icon={<EditOutlined />} onClick={() => setEditor({ open: true, indicator: ind, draft: null })} aria-label={`Modifier ${ind.name}`} />
                          </Tooltip>
                          <Tooltip title="Supprimer">
                            <Button
                              type="text"
                              size="small"
                              danger
                              icon={<DeleteOutlined />}
                              aria-label={`Supprimer ${ind.name}`}
                              onClick={() =>
                                modal.confirm({
                                  title: `Supprimer « ${ind.name} » ?`,
                                  content: 'L’indicateur disparaît aussi du plan de trésorerie.',
                                  okText: 'Supprimer',
                                  okButtonProps: { danger: true },
                                  cancelText: 'Annuler',
                                  onOk: async () => {
                                    await deleteIndicator(ind.id);
                                    message.success('Indicateur supprimé');
                                  },
                                })
                              }
                            />
                          </Tooltip>
                        </span>
                      ),
                    },
                  ]
                : []),
            ]}
          />
        )}
      </section>

      <IndicatorEditor
        open={editor.open}
        indicator={editor.indicator}
        draft={editor.draft}
        plan={plan}
        previewMonths={previewMonths}
        onClose={() => setEditor({ open: false, indicator: null, draft: null })}
      />
    </div>
  );
}
