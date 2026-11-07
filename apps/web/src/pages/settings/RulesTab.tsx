import { useMemo, useState } from 'react';
import { Alert, App, Button, Checkbox, Empty, Input, InputNumber, Modal, Select, Switch, Tag } from 'antd';
import { ArrowDownOutlined, ArrowUpOutlined, DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import {
  describeCondition,
  formatDate,
  formatEuro,
  ruleMatchesIn,
  type Rule,
  type RuleCondition,
} from '@optimum/treso-engine';
import { ApiError } from '../../api/client';
import { accountLabel, canWrite } from '../../api/types';
import { CategorySelect } from '../../components/CategorySelect';
import { useStore } from '../../store/useStore';

const errMsg = (e: unknown, f: string) => (e instanceof ApiError ? e.message : f);

type Draft = { id?: string; conditions: RuleCondition[]; categoryId: string | null; autoApply: boolean; priority: number };

/** Éditeur de règle avec aperçu en direct des opérations concernées. */
function RuleEditor({ draft, onClose }: { draft: Draft; onClose: () => void }) {
  const { message } = App.useApp();
  const transactions = useStore((s) => s.transactions);
  const accounts = useStore((s) => s.accounts);
  const categories = useStore((s) => s.categories);
  const createRule = useStore((s) => s.createRule);
  const updateRule = useStore((s) => s.updateRule);
  const applyRule = useStore((s) => s.applyRule);
  const [d, setD] = useState<Draft>(draft);
  const [applyNow, setApplyNow] = useState(!draft.id);
  const [saving, setSaving] = useState(false);
  const flow = categories.find((c) => c.id === d.categoryId)?.flow ?? 'out';

  const valid = d.categoryId && d.conditions.length > 0 && d.conditions.every((c) => (c.field === 'label' ? c.value.trim().length > 0 : c.field === 'amount' ? c.min <= c.max : Boolean(c.value)));
  const matches = useMemo(
    () => (valid ? ruleMatchesIn({ conditions: d.conditions }, transactions).filter((t) => !t.parentId && (flow === 'in' ? t.amount > 0 : t.amount < 0)) : []),
    [valid, d.conditions, transactions, flow],
  );
  const uncategorized = matches.filter((t) => !t.categoryId && !t.hidden).length;

  const setCond = (i: number, c: RuleCondition) => setD((x) => ({ ...x, conditions: x.conditions.map((y, j) => (j === i ? c : y)) }));

  const save = async () => {
    if (!valid) return;
    setSaving(true);
    try {
      const payload = { conditions: d.conditions, categoryId: d.categoryId!, autoApply: d.autoApply, priority: d.priority };
      const id = d.id ? (await updateRule(d.id, payload), d.id) : (await createRule(payload)).id;
      if (applyNow && uncategorized > 0) {
        const n = await applyRule(id);
        message.success(`Règle enregistrée · ${n} opération${n > 1 ? 's' : ''} catégorisée${n > 1 ? 's' : ''}`);
      } else message.success('Règle enregistrée');
      onClose();
    } catch (e) {
      message.error(errMsg(e, "La règle n'a pas pu être enregistrée."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onCancel={onClose} width={720} title={d.id ? 'Modifier la règle' : 'Nouvelle règle'} okText="Enregistrer" cancelText="Annuler" okButtonProps={{ disabled: !valid, loading: saving }} onOk={save} destroyOnHidden>
      <div className="rule-editor">
        <fieldset>
          <legend>Si l'opération…</legend>
          {d.conditions.map((c, i) => (
            <div key={i} className="rule-cond">
              <Select
                value={c.field === 'label' ? `label:${c.op}` : c.field}
                style={{ width: 190 }}
                aria-label={`Type de la condition ${i + 1}`}
                onChange={(v: string) => {
                  if (v.startsWith('label:')) setCond(i, { field: 'label', op: v.slice(6) as 'contains' | 'startsWith', value: c.field === 'label' ? c.value : '' });
                  else if (v === 'amount') setCond(i, { field: 'amount', op: 'between', min: -1000, max: 0 });
                  else setCond(i, { field: 'account', op: 'is', value: accounts[0]?.id ?? '' });
                }}
                options={[
                  { value: 'label:contains', label: 'Libellé contient' },
                  { value: 'label:startsWith', label: 'Libellé commence par' },
                  { value: 'amount', label: 'Montant entre' },
                  { value: 'account', label: 'Compte' },
                ]}
              />
              {c.field === 'label' && <Input value={c.value} onChange={(e) => setCond(i, { ...c, value: e.target.value })} placeholder="Ex. : URSSAF" aria-label="Texte recherché" style={{ flex: 1 }} />}
              {c.field === 'amount' && (
                <span className="rule-range">
                  <InputNumber<number> value={c.min} onChange={(v) => setCond(i, { ...c, min: v ?? 0 })} decimalSeparator="," addonAfter="€" aria-label="Montant minimum" />
                  et
                  <InputNumber<number> value={c.max} onChange={(v) => setCond(i, { ...c, max: v ?? 0 })} decimalSeparator="," addonAfter="€" aria-label="Montant maximum" />
                </span>
              )}
              {c.field === 'account' && (
                <Select value={c.value} onChange={(v: string) => setCond(i, { ...c, value: v })} options={accounts.map((a) => ({ value: a.id, label: accountLabel(a) }))} style={{ flex: 1 }} aria-label="Compte" />
              )}
              <Button type="text" icon={<DeleteOutlined />} disabled={d.conditions.length === 1} aria-label={`Retirer la condition ${i + 1}`} onClick={() => setD((x) => ({ ...x, conditions: x.conditions.filter((_, j) => j !== i) }))} />
            </div>
          ))}
          {d.conditions.length < 5 && (
            <Button type="link" icon={<PlusOutlined />} onClick={() => setD((x) => ({ ...x, conditions: [...x.conditions, { field: 'label', op: 'contains', value: '' }] }))}>
              Ajouter une condition (toutes doivent correspondre)
            </Button>
          )}
        </fieldset>
        <fieldset>
          <legend>…alors la classer en</legend>
          <CategorySelect flow={flow} value={d.categoryId} onChange={(id) => setD((x) => ({ ...x, categoryId: id }))} ariaLabel="Catégorie de la règle" allowClear={false} placeholder="Choisir une catégorie" style={{ width: 320 }} />
          <label className="rule-switch">
            <Switch checked={d.autoApply} onChange={(v) => setD((x) => ({ ...x, autoApply: v }))} />
            Appliquer automatiquement (sinon, simple suggestion à valider)
          </label>
        </fieldset>
        <div className="rule-preview" aria-live="polite">
          <strong>
            {matches.length} opération{matches.length > 1 ? 's' : ''} correspond{matches.length > 1 ? 'ent' : ''}
          </strong>
          {uncategorized > 0 && (
            <Checkbox checked={applyNow} onChange={(e) => setApplyNow(e.target.checked)}>
              Catégoriser les {uncategorized} non catégorisée{uncategorized > 1 ? 's' : ''} maintenant
            </Checkbox>
          )}
          <ul>
            {matches.slice(0, 6).map((t) => (
              <li key={t.id}>
                <span>{formatDate(t.bookedAt, false)} · {t.label}</span>
                <span className="num">{formatEuro(t.amount)}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Modal>
  );
}

/** Règles de catégorisation (Paramètres > Règles). */
export function RulesTab() {
  const { message, modal } = App.useApp();
  const rules = useStore((s) => s.rules);
  const transactions = useStore((s) => s.transactions);
  const categories = useStore((s) => s.categories);
  const accounts = useStore((s) => s.accounts);
  const role = useStore((s) => s.role);
  const updateRule = useStore((s) => s.updateRule);
  const deleteRule = useStore((s) => s.deleteRule);
  const reorderRules = useStore((s) => s.reorderRules);
  const applyRule = useStore((s) => s.applyRule);
  const writable = canWrite(role);
  const [editing, setEditing] = useState<Draft | null>(null);
  const sorted = useMemo(() => [...rules].sort((a, b) => b.priority - a.priority), [rules]);
  const catName = (id: string) => categories.find((c) => c.id === id)?.name ?? '—';
  const accName = (id: string) => {
    const a = accounts.find((x) => x.id === id);
    return a ? accountLabel(a) : id;
  };

  const move = (i: number, delta: number) => {
    const ids = sorted.map((r) => r.id);
    const j = i + delta;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    reorderRules(ids).catch((e) => message.error(errMsg(e, "L'ordre n'a pas pu être enregistré.")));
  };

  return (
    <div className="settings-section">
      <p className="muted">
        Les règles classent automatiquement vos opérations. La première règle de la liste qui correspond l'emporte.
      </p>
      {!writable && <Alert type="info" showIcon message="Votre rôle permet de consulter les règles, pas de les modifier." />}
      {writable && (
        <div>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setEditing({ conditions: [{ field: 'label', op: 'contains', value: '' }], categoryId: null, autoApply: true, priority: (sorted[0]?.priority ?? 0) + 1 })}>
            Nouvelle règle
          </Button>
        </div>
      )}
      {sorted.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Aucune règle. Créez-en une ici, ou depuis une opération après l'avoir catégorisée (« Créer une règle »)." />
      ) : (
        <ol className="rule-list">
          {sorted.map((r: Rule, i) => {
            const count = ruleMatchesIn(r, transactions).filter((t) => !t.parentId).length;
            return (
              <li key={r.id}>
                <div className="rule-order">
                  <Button size="small" type="text" icon={<ArrowUpOutlined />} disabled={!writable || i === 0} aria-label="Monter la règle" onClick={() => move(i, -1)} />
                  <Button size="small" type="text" icon={<ArrowDownOutlined />} disabled={!writable || i === sorted.length - 1} aria-label="Descendre la règle" onClick={() => move(i, 1)} />
                </div>
                <div className="rule-text">
                  <span>{r.conditions.map((c) => describeCondition(c, accName)).join(' et ')}</span>
                  <span className="muted">
                    → <strong>{catName(r.categoryId)}</strong> · {count} opération{count > 1 ? 's' : ''} concernée{count > 1 ? 's' : ''}
                  </span>
                </div>
                <Tag color={r.autoApply ? 'green' : 'default'}>{r.autoApply ? 'Automatique' : 'Suggestion'}</Tag>
                {writable && (
                  <span className="rule-actions">
                    <Switch size="small" checked={r.autoApply} aria-label="Appliquer automatiquement" onChange={(v) => updateRule(r.id, { autoApply: v })} />
                    <Button size="small" onClick={async () => { const n = await applyRule(r.id); message.success(n ? `${n} opération${n > 1 ? 's' : ''} catégorisée${n > 1 ? 's' : ''}` : 'Aucune opération à catégoriser'); }}>
                      Appliquer aux opérations existantes
                    </Button>
                    <Button size="small" type="text" icon={<EditOutlined />} aria-label="Modifier la règle" onClick={() => setEditing({ ...r })} />
                    <Button
                      size="small"
                      type="text"
                      danger
                      icon={<DeleteOutlined />}
                      aria-label="Supprimer la règle"
                      onClick={() =>
                        modal.confirm({
                          title: 'Supprimer cette règle ?',
                          content: 'Les opérations déjà catégorisées gardent leur catégorie.',
                          okText: 'Supprimer',
                          okButtonProps: { danger: true },
                          cancelText: 'Annuler',
                          onOk: () => deleteRule(r.id),
                        })
                      }
                    />
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      )}
      {editing && <RuleEditor draft={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
