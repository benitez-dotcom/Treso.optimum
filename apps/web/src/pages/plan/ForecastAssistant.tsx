/**
 * « Construire mon prévisionnel » (écran 7.4) en 4 étapes : historique,
 * croissance, événements, validation.
 */
import { useEffect, useMemo, useState } from 'react';
import { App, Button, Checkbox, DatePicker, Empty, Form, Input, InputNumber, Modal, Radio, Select, Steps, Table, Tag } from 'antd';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import {
  addMonths,
  buildForecast,
  eventAmounts,
  formatEuroRounded,
  formatMonthShort,
  historyAverages,
  loanInstallment,
  monthRange,
  type Category,
  type ForecastEvent,
  type MonthKey,
} from '@optimum/treso-engine';
import { useStore } from '../../store/useStore';
import { SCENARIO_COLORS } from './format';

interface Props {
  open: boolean;
  currentMonth: MonthKey;
  baseScenarioId: string;
  canCreateScenario: boolean;
  onClose: () => void;
  onApplied: (scenarioId: string) => void;
}

type EventType = ForecastEvent['type'];
const EVENT_LABELS: Record<EventType, string> = {
  hire: 'Recrutement',
  investment: 'Investissement',
  loan: 'Emprunt',
  fundraising: 'Levée de fonds',
};

const fmtPct = (v: number) => `${v > 0 ? '+' : ''}${v.toLocaleString('fr-FR')} %`;

export function ForecastAssistant({ open, currentMonth, baseScenarioId, canCreateScenario, onClose, onApplied }: Props) {
  const { message } = App.useApp();
  const categories = useStore((s) => s.categories);
  const transactions = useStore((s) => s.transactions);
  const scenarios = useStore((s) => s.scenarios);
  const applyBudgets = useStore((s) => s.applyBudgets);
  const addScenario = useStore((s) => s.addScenario);

  const [step, setStep] = useState(0);
  const [lookback, setLookback] = useState<3 | 6 | 12>(6);
  const [excludeExceptional, setExcludeExceptional] = useState(true);
  const [overrides, setOverrides] = useState<Map<string, { include: boolean; amount: number }>>(new Map());
  const [growthIn, setGrowthIn] = useState(0);
  const [growthOut, setGrowthOut] = useState(0);
  const [events, setEvents] = useState<ForecastEvent[]>([]);
  const [adding, setAdding] = useState<EventType | null>(null);
  const [startMonth, setStartMonth] = useState<MonthKey>(currentMonth);
  const [duration, setDuration] = useState(12);
  const [target, setTarget] = useState<'base' | 'new'>('base');
  const [newName, setNewName] = useState('Prévisionnel de l’assistant');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setStep(0);
    setOverrides(new Map());
    setGrowthIn(0);
    setGrowthOut(0);
    setEvents([]);
    setAdding(null);
    setStartMonth(currentMonth);
    setDuration(12);
    setTarget('base');
  }, [open, currentMonth]);

  const byId = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const leaves = useMemo(() => categories.filter((c) => !c.isVat && !categories.some((k) => k.parentId === c.id)), [categories]);
  const averages = useMemo(
    () => historyAverages(categories, transactions, currentMonth, lookback, { excludeExceptional }),
    [categories, transactions, currentMonth, lookback, excludeExceptional],
  );
  useEffect(() => setOverrides(new Map()), [lookback, excludeExceptional]);

  const baseline = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of averages) {
      const o = overrides.get(a.categoryId);
      if (o && !o.include) continue;
      m.set(a.categoryId, o?.amount ?? a.average);
    }
    return m;
  }, [averages, overrides]);

  const months = useMemo(() => monthRange(startMonth, duration), [startMonth, duration]);
  const preview = useMemo(
    () => buildForecast({ baseline, growthIn, growthOut, events }, categories, months, 'preview'),
    [baseline, growthIn, growthOut, events, categories, months],
  );
  const monthlyTotals = useMemo(
    () =>
      months.map((m) => {
        let tin = 0;
        let tout = 0;
        for (const b of preview) {
          if (b.month !== m) continue;
          if (byId.get(b.categoryId)?.flow === 'in') tin += b.amount ?? 0;
          else tout += b.amount ?? 0;
        }
        return { month: m, in: tin, out: tout };
      }),
    [preview, months, byId],
  );

  const setOverride = (id: string, patch: Partial<{ include: boolean; amount: number }>) =>
    setOverrides((prev) => {
      const next = new Map(prev);
      const avg = averages.find((a) => a.categoryId === id)!.average;
      next.set(id, { include: true, amount: avg, ...prev.get(id), ...patch });
      return next;
    });

  const apply = async () => {
    setSaving(true);
    try {
      let scenarioId = baseScenarioId;
      if (target === 'new') {
        const used = new Set(scenarios.map((s) => s.color));
        const color = (SCENARIO_COLORS.find((c) => !used.has(c.value)) ?? SCENARIO_COLORS[0]!).value;
        scenarioId = await addScenario(newName.trim() || 'Prévisionnel', color, undefined, 'Créé avec l’assistant prévisionnel.');
      }
      applyBudgets(preview.map((b) => ({ ...b, scenarioId })));
      message.success(`${preview.length} budgets créés de ${formatMonthShort(months[0]!)} à ${formatMonthShort(months[months.length - 1]!)}.`);
      onApplied(scenarioId);
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Le prévisionnel n’a pas pu être enregistré.');
    } finally {
      setSaving(false);
    }
  };

  const catName = (id: string) => byId.get(id)?.name ?? '—';
  const flowOf = (c: Category | undefined) => (c?.flow === 'in' ? 'Encaissement' : 'Décaissement');

  const stepHistory = (
    <div className="assistant-step">
      <div className="assistant-controls">
        <span>Moyenne des</span>
        <Radio.Group value={lookback} onChange={(e) => setLookback(e.target.value)} optionType="button" options={[{ value: 3, label: '3 derniers mois' }, { value: 6, label: '6 derniers mois' }, { value: 12, label: '12 derniers mois' }]} />
        <Checkbox checked={excludeExceptional} onChange={(e) => setExcludeExceptional(e.target.checked)}>
          Exclure les mois exceptionnels
        </Checkbox>
      </div>
      {averages.length === 0 ? (
        <Empty description="Pas encore d’historique catégorisé : passez directement aux événements ou saisissez vos budgets dans la grille." />
      ) : (
        <Table
          size="small"
          rowKey="categoryId"
          pagination={false}
          scroll={{ y: 320 }}
          dataSource={averages}
          columns={[
            {
              title: '',
              width: 40,
              render: (_, a) => (
                <Checkbox
                  checked={overrides.get(a.categoryId)?.include ?? true}
                  onChange={(e) => setOverride(a.categoryId, { include: e.target.checked })}
                  aria-label={`Inclure ${catName(a.categoryId)}`}
                />
              ),
            },
            { title: 'Catégorie', render: (_, a) => <span>{catName(a.categoryId)} <span className="muted">· {flowOf(byId.get(a.categoryId))}</span></span> },
            {
              title: 'Historique',
              render: (_, a) => (
                <span className="history-cells">
                  {a.monthly.map((m) => (
                    <span key={m.month} className={m.excluded ? 'excluded' : undefined} title={`${formatMonthShort(m.month)} : ${formatEuroRounded(m.amount)}${m.excluded ? ' (exclu)' : ''}`}>
                      {Math.round(m.amount / 100) / 10}k
                    </span>
                  ))}
                </span>
              ),
            },
            {
              title: 'Par mois',
              align: 'right',
              width: 150,
              render: (_, a) => (
                <InputNumber
                  size="small"
                  min={0}
                  value={overrides.get(a.categoryId)?.amount ?? a.average}
                  disabled={overrides.get(a.categoryId)?.include === false}
                  onChange={(v) => setOverride(a.categoryId, { amount: v ?? 0 })}
                  formatter={(v) => (v === undefined ? '' : Number(v).toLocaleString('fr-FR'))}
                  parser={(v) => Number((v ?? '').replace(/\s| | /g, '').replace(',', '.'))}
                  addonAfter="€"
                  aria-label={`Montant mensuel ${catName(a.categoryId)}`}
                />
              ),
            },
          ]}
        />
      )}
    </div>
  );

  const stepGrowth = (
    <div className="assistant-step growth-step">
      <label>
        <span>Croissance des encaissements</span>
        <InputNumber value={growthIn} onChange={(v) => setGrowthIn(v ?? 0)} min={-90} max={500} addonAfter="%" decimalSeparator="," />
      </label>
      <label>
        <span>Évolution des décaissements</span>
        <InputNumber value={growthOut} onChange={(v) => setGrowthOut(v ?? 0)} min={-90} max={500} addonAfter="%" decimalSeparator="," />
      </label>
      <p className="muted">La croissance s’applique aux moyennes de l’historique, sur toute la période du prévisionnel.</p>
    </div>
  );

  const stepEvents = (
    <div className="assistant-step">
      <div className="event-buttons">
        {(Object.keys(EVENT_LABELS) as EventType[]).map((t) => (
          <Button key={t} icon={<PlusOutlined />} onClick={() => setAdding(t)} type={adding === t ? 'primary' : 'default'}>
            {EVENT_LABELS[t]}
          </Button>
        ))}
      </div>
      {adding && (
        <EventForm
          type={adding}
          leaves={leaves}
          defaultMonth={addMonths(currentMonth, 1)}
          onCancel={() => setAdding(null)}
          onAdd={(e) => {
            setEvents((list) => [...list, e]);
            setAdding(null);
          }}
        />
      )}
      {events.length === 0 && !adding && <p className="muted">Ajoutez les événements connus : ils s’ajoutent aux montants de l’historique.</p>}
      <ul className="event-list">
        {events.map((e, i) => {
          const total = eventAmounts(e, months).reduce((s, a) => s + a.amount, 0);
          return (
            <li key={i}>
              <Tag>{EVENT_LABELS[e.type]}</Tag>
              <strong>{e.label}</strong>
              <span className="muted">à partir de {formatMonthShort(e.month)}</span>
              <span className="num">{formatEuroRounded(total)} sur la période</span>
              <Button type="text" size="small" icon={<DeleteOutlined />} aria-label={`Retirer ${e.label}`} onClick={() => setEvents((l) => l.filter((_, j) => j !== i))} />
            </li>
          );
        })}
      </ul>
    </div>
  );

  const stepValidate = (
    <div className="assistant-step">
      <div className="assistant-controls">
        <span>De</span>
        <DatePicker picker="month" format="MMM YYYY" allowClear={false} value={dayjs(startMonth)} onChange={(d) => d && setStartMonth(d.format('YYYY-MM-01'))} />
        <span>pendant</span>
        <Select value={duration} onChange={setDuration} style={{ width: 110 }} options={[6, 12, 18, 24].map((n) => ({ value: n, label: `${n} mois` }))} />
      </div>
      <div className="assistant-summary">
        <p>
          <strong>{preview.length}</strong> budgets · {baseline.size} catégories · croissance {fmtPct(growthIn)} / {fmtPct(growthOut)} · {events.length} événement{events.length > 1 ? 's' : ''}
        </p>
        <table className="mini-table">
          <thead>
            <tr>
              <th />
              {monthlyTotals.map((t) => (
                <th key={t.month}>{formatMonthShort(t.month)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="in">
              <th>Encaissements</th>
              {monthlyTotals.map((t) => (
                <td key={t.month}>{Math.round(t.in).toLocaleString('fr-FR')}</td>
              ))}
            </tr>
            <tr>
              <th>Décaissements</th>
              {monthlyTotals.map((t) => (
                <td key={t.month}>{Math.round(t.out).toLocaleString('fr-FR')}</td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      <Radio.Group value={target} onChange={(e) => setTarget(e.target.value)} className="assistant-target">
        <Radio value="base">Appliquer à mon scénario de base (les budgets existants de ces catégories et de ces mois sont remplacés)</Radio>
        <Radio value="new" disabled={!canCreateScenario}>
          Créer un nouveau scénario
        </Radio>
      </Radio.Group>
      {target === 'new' && <Input value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={80} aria-label="Nom du scénario" style={{ maxWidth: 360 }} />}
    </div>
  );

  const steps = [
    { title: 'Historique', content: stepHistory },
    { title: 'Croissance', content: stepGrowth },
    { title: 'Événements', content: stepEvents },
    { title: 'Validation', content: stepValidate },
  ];

  return (
    <Modal
      open={open}
      onCancel={onClose}
      width={880}
      title="Construire mon prévisionnel"
      destroyOnHidden
      footer={[
        step > 0 && (
          <Button key="prev" onClick={() => setStep(step - 1)}>
            Précédent
          </Button>
        ),
        step < 3 ? (
          <Button key="next" type="primary" onClick={() => setStep(step + 1)}>
            Suivant
          </Button>
        ) : (
          <Button key="apply" type="primary" loading={saving} disabled={preview.length === 0} onClick={apply}>
            {target === 'base' ? 'Appliquer à mon scénario de base' : 'Créer le scénario'}
          </Button>
        ),
      ]}
    >
      <Steps size="small" current={step} onChange={setStep} items={steps.map((s) => ({ title: s.title }))} className="assistant-steps" />
      {steps[step]!.content}
    </Modal>
  );
}

interface EventFormProps {
  type: EventType;
  leaves: Category[];
  defaultMonth: MonthKey;
  onCancel: () => void;
  onAdd: (e: ForecastEvent) => void;
}

function EventForm({ type, leaves, defaultMonth, onCancel, onAdd }: EventFormProps) {
  const [form] = Form.useForm();
  const ins = leaves.filter((c) => c.flow === 'in');
  const outs = leaves.filter((c) => c.flow === 'out');
  const opts = (list: Category[]) => list.map((c) => ({ value: c.id, label: c.name }));
  const find = (list: Category[], re: RegExp) => list.find((c) => re.test(c.name))?.id ?? list[0]?.id;
  const otherIn = ins.find((c) => c.kind !== 'revenue')?.id ?? ins[0]?.id;

  const initial: Record<EventType, Record<string, unknown>> = {
    hire: { label: 'Recrutement', grossMonthlySalary: 3000, employerChargesRate: 45, salaryCategoryId: find(outs, /salaire/i), chargesCategoryId: find(outs, /urssaf|charges sociales/i) },
    investment: { label: 'Investissement', amount: 10000, categoryId: outs[0]?.id },
    loan: { label: 'Emprunt bancaire', amount: 50000, annualRate: 4, durationMonths: 60, inflowCategoryId: otherIn, repaymentCategoryId: find(outs, /emprunt/i) },
    fundraising: { label: 'Levée de fonds', amount: 100000, categoryId: otherIn },
  };

  const values = Form.useWatch([], form) as Record<string, number> | undefined;
  const installment = type === 'loan' && values?.amount && values.durationMonths ? loanInstallment(values.amount, values.annualRate ?? 0, values.durationMonths) : null;

  return (
    <Form
      form={form}
      layout="vertical"
      className="event-form"
      initialValues={{ ...initial[type], month: dayjs(defaultMonth) }}
      requiredMark={false}
      onFinish={(v) => onAdd({ ...v, type, month: v.month.format('YYYY-MM-01') } as ForecastEvent)}
    >
      <div className="event-grid">
        <Form.Item name="label" label="Libellé" rules={[{ required: true, message: 'Donnez un libellé.' }]}>
          <Input maxLength={80} />
        </Form.Item>
        <Form.Item name="month" label={type === 'hire' ? 'Arrivée' : 'Mois'} rules={[{ required: true }]}>
          <DatePicker picker="month" format="MMM YYYY" allowClear={false} />
        </Form.Item>
        {type === 'hire' && (
          <>
            <Form.Item name="grossMonthlySalary" label="Salaire brut mensuel" rules={[{ required: true }]}>
              <InputNumber min={0} addonAfter="€" />
            </Form.Item>
            <Form.Item name="employerChargesRate" label="Charges patronales" rules={[{ required: true }]}>
              <InputNumber min={0} max={100} addonAfter="%" />
            </Form.Item>
            <Form.Item name="salaryCategoryId" label="Catégorie du salaire" rules={[{ required: true }]}>
              <Select options={opts(outs)} showSearch optionFilterProp="label" />
            </Form.Item>
            <Form.Item name="chargesCategoryId" label="Catégorie des charges" rules={[{ required: true }]}>
              <Select options={opts(outs)} showSearch optionFilterProp="label" />
            </Form.Item>
          </>
        )}
        {(type === 'investment' || type === 'fundraising') && (
          <>
            <Form.Item name="amount" label="Montant TTC" rules={[{ required: true }]}>
              <InputNumber min={0} addonAfter="€" />
            </Form.Item>
            <Form.Item name="categoryId" label="Catégorie" rules={[{ required: true }]}>
              <Select options={opts(type === 'investment' ? outs : ins)} showSearch optionFilterProp="label" />
            </Form.Item>
          </>
        )}
        {type === 'loan' && (
          <>
            <Form.Item name="amount" label="Montant emprunté" rules={[{ required: true }]}>
              <InputNumber min={0} addonAfter="€" />
            </Form.Item>
            <Form.Item name="annualRate" label="Taux annuel" rules={[{ required: true }]}>
              <InputNumber min={0} max={30} step={0.1} decimalSeparator="," addonAfter="%" />
            </Form.Item>
            <Form.Item name="durationMonths" label="Durée" rules={[{ required: true }]}>
              <InputNumber min={1} max={360} addonAfter="mois" />
            </Form.Item>
            <Form.Item name="inflowCategoryId" label="Catégorie du versement" rules={[{ required: true }]}>
              <Select options={opts(ins)} showSearch optionFilterProp="label" />
            </Form.Item>
            <Form.Item name="repaymentCategoryId" label="Catégorie des remboursements" rules={[{ required: true }]}>
              <Select options={opts(outs)} showSearch optionFilterProp="label" />
            </Form.Item>
          </>
        )}
      </div>
      {installment !== null && <p className="muted">Mensualité : {formatEuroRounded(installment)} à partir du mois suivant le versement.</p>}
      <div className="event-actions">
        <Button onClick={onCancel}>Annuler</Button>
        <Button type="primary" htmlType="submit">
          Ajouter l’événement
        </Button>
      </div>
    </Form>
  );
}
