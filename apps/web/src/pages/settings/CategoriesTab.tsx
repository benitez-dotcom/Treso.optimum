/**
 * Catégories (écran 7.9) : deux arbres (encaissements, décaissements) avec
 * glisser-déposer, panneau d'édition, fusion, suppression avec déplacement,
 * modèles sectoriels.
 */
import { useMemo, useState, type ReactNode } from 'react';
import { App, Button, Checkbox, Drawer, Dropdown, Form, Input, Modal, Radio, Select, Switch, Tag, Tooltip, Tree, type TreeDataNode, type TreeProps } from 'antd';
import {
  AppstoreAddOutlined,
  BankOutlined,
  BookOutlined,
  CarOutlined,
  CoffeeOutlined,
  EuroOutlined,
  FileTextOutlined,
  GiftOutlined,
  HomeOutlined,
  LaptopOutlined,
  NotificationOutlined,
  PercentageOutlined,
  PhoneOutlined,
  PlusOutlined,
  RocketOutlined,
  SafetyOutlined,
  ShopOutlined,
  ShoppingCartOutlined,
  TeamOutlined,
  ThunderboltOutlined,
  ToolOutlined,
} from '@ant-design/icons';
import {
  addDays,
  CATEGORY_TEMPLATES,
  effectiveKind,
  KIND_LABELS,
  subtreeIds,
  templateAdditions,
  VAT_RATES,
  type Category,
  type CategoryKind,
  type Flow,
  type MoveConsequence,
} from '@optimum/treso-engine';
import { useStore } from '../../store/useStore';
import { api, ApiError } from '../../api/client';
import { canWrite } from '../../api/types';

export const CATEGORY_ICONS: Record<string, { label: string; icon: ReactNode }> = {
  shop: { label: 'Boutique', icon: <ShopOutlined /> },
  cart: { label: 'Achats', icon: <ShoppingCartOutlined /> },
  euro: { label: 'Euro', icon: <EuroOutlined /> },
  team: { label: 'Équipe', icon: <TeamOutlined /> },
  home: { label: 'Locaux', icon: <HomeOutlined /> },
  car: { label: 'Véhicule', icon: <CarOutlined /> },
  tool: { label: 'Outils', icon: <ToolOutlined /> },
  bank: { label: 'Banque', icon: <BankOutlined /> },
  laptop: { label: 'Informatique', icon: <LaptopOutlined /> },
  phone: { label: 'Télécom', icon: <PhoneOutlined /> },
  notification: { label: 'Marketing', icon: <NotificationOutlined /> },
  gift: { label: 'Cadeaux', icon: <GiftOutlined /> },
  coffee: { label: 'Restauration', icon: <CoffeeOutlined /> },
  energy: { label: 'Énergie', icon: <ThunderboltOutlined /> },
  safety: { label: 'Assurance', icon: <SafetyOutlined /> },
  file: { label: 'Documents', icon: <FileTextOutlined /> },
  percent: { label: 'Taxes', icon: <PercentageOutlined /> },
  rocket: { label: 'Projet', icon: <RocketOutlined /> },
  book: { label: 'Formation', icon: <BookOutlined /> },
};

const COLORS = ['#114C5C', '#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#8A6FB0', '#5c5c5d'];

const KIND_OPTIONS: CategoryKind[] = ['revenue', 'purchases', 'overheads', 'payroll', 'none'];

type Editing = { mode: 'edit'; id: string } | { mode: 'create'; flow: Flow; parentId: string | null } | null;

export function CategoriesTab() {
  const { message, modal } = App.useApp();
  const s = useStore();
  const mayEdit = canWrite(s.role);
  const [editing, setEditing] = useState<Editing>(null);
  const [relocate, setRelocate] = useState<{ id: string; mode: 'merge' | 'delete'; reason?: string } | null>(null);
  const [busy, setBusy] = useState(false);

  // Nombre d'opérations sur 12 mois, sous-catégories comprises
  const counts = useMemo(() => {
    const since = addDays(s.today, -365);
    const own = new Map<string, number>();
    for (const t of s.transactions) if (t.categoryId && !t.isSplit && t.bookedAt >= since) own.set(t.categoryId, (own.get(t.categoryId) ?? 0) + 1);
    return new Map(s.categories.map((c) => [c.id, subtreeIds(s.categories, c.id).reduce((n, id) => n + (own.get(id) ?? 0), 0)]));
  }, [s.transactions, s.categories, s.today]);

  const fail = (e: unknown) => message.error(e instanceof Error ? e.message : 'Action impossible.');

  const doMove = async (id: string, parentId: string | null, index: number) => {
    try {
      let budgets: 'sum' | 'delete' | undefined;
      const cat = s.categories.find((c) => c.id === id)!;
      if (parentId && parentId !== cat.parentId) {
        const c = await api<MoveConsequence>('POST', `/categories/${encodeURIComponent(id)}/move-preview`, { parentId });
        if (c.kind !== 'none') {
          budgets = await new Promise<'sum' | 'delete' | undefined>((resolve) => {
            const m = modal.confirm({
              title: 'Que faire des budgets ?',
              content: c.message,
              okText: 'Conserver en additionnant',
              cancelText: 'Annuler',
              onOk: () => resolve('sum'),
              onCancel: () => resolve(undefined),
              footer: (_, { OkBtn, CancelBtn }) => (
                <>
                  <CancelBtn />
                  <Button
                    danger
                    onClick={() => {
                      resolve('delete');
                      m.destroy();
                    }}
                  >
                    Supprimer les budgets
                  </Button>
                  <OkBtn />
                </>
              ),
            });
          });
          if (!budgets) return;
        }
      }
      await s.moveCategory(id, parentId, index, budgets);
      message.success('Catégorie déplacée');
    } catch (e) {
      fail(e);
    }
  };

  const onDrop: TreeProps['onDrop'] = (info) => {
    const dragId = String(info.dragNode.key);
    const target = s.categories.find((c) => c.id === String(info.node.key))!;
    const pos = info.node.pos.split('-');
    const relative = info.dropPosition - Number(pos[pos.length - 1]);
    if (!info.dropToGap) return void doMove(dragId, target.id, 0);
    const siblings = s.categories
      .filter((c) => c.flow === target.flow && c.parentId === target.parentId && c.id !== dragId)
      .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name, 'fr'));
    const idx = siblings.findIndex((c) => c.id === target.id);
    void doMove(dragId, target.parentId, idx + (relative === -1 ? 0 : 1));
  };

  const tree = (flow: Flow): TreeDataNode[] => {
    const build = (parentId: string | null): TreeDataNode[] =>
      s.categories
        .filter((c) => c.flow === flow && (c.parentId ?? null) === parentId)
        .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name, 'fr'))
        .map((c) => ({ key: c.id, title: <CategoryRow c={c} count={counts.get(c.id) ?? 0} />, children: build(c.id), isLeaf: !s.categories.some((k) => k.parentId === c.id) }));
    return build(null);
  };

  const applyTemplate = (key: string) => {
    const t = CATEGORY_TEMPLATES.find((x) => x.key === key)!;
    const additions = templateAdditions(s.categories, t.categories);
    if (!additions.length) {
      message.info(`Toutes les catégories du modèle ${t.name} existent déjà.`);
      return;
    }
    modal.confirm({
      title: `Appliquer le modèle ${t.name} ?`,
      content: (
        <>
          <p>
            {additions.length} catégorie{additions.length > 1 ? 's' : ''} {additions.length > 1 ? 'seront ajoutées' : 'sera ajoutée'} : {additions.map((a) => a.name).join(', ')}.
          </p>
          <p className="muted">Rien n’est supprimé ni modifié.</p>
        </>
      ),
      okText: 'Ajouter',
      cancelText: 'Annuler',
      onOk: async () => {
        try {
          const n = await s.applyCategoryTemplate(key);
          message.success(`${n} catégorie${n > 1 ? 's' : ''} ajoutée${n > 1 ? 's' : ''}`);
        } catch (e) {
          fail(e);
        }
      },
    });
  };

  const editingCat = editing?.mode === 'edit' ? s.categories.find((c) => c.id === editing.id) : undefined;

  return (
    <div className="categories-tab">
      <div className="categories-head">
        <p className="muted">
          Glissez une catégorie pour la réordonner ou la ranger dans une autre. Le type (chiffre d’affaires, achats…) alimente les indicateurs d’analyse.
        </p>
        {mayEdit && (
          <Dropdown
            trigger={['click']}
            menu={{
              items: CATEGORY_TEMPLATES.map((t) => ({
                key: t.key,
                label: (
                  <span className="template-item">
                    <strong>{t.name}</strong>
                    <span className="muted">{t.description}</span>
                  </span>
                ),
              })),
              onClick: ({ key }) => applyTemplate(key),
            }}
          >
            <Button icon={<AppstoreAddOutlined />}>Appliquer un modèle</Button>
          </Dropdown>
        )}
      </div>
      <div className="categories-cols">
        {(['in', 'out'] as const).map((flow) => (
          <section key={flow} className="categories-col">
            <div className="categories-col-head">
              <h3>{flow === 'in' ? 'Encaissements' : 'Décaissements'}</h3>
              {mayEdit && (
                <Button size="small" icon={<PlusOutlined />} onClick={() => setEditing({ mode: 'create', flow, parentId: null })}>
                  Ajouter une catégorie
                </Button>
              )}
            </div>
            <Tree
              className="categories-tree"
              blockNode
              defaultExpandAll
              draggable={mayEdit ? { icon: false } : false}
              treeData={tree(flow)}
              allowDrop={({ dropNode, dropPosition }) => !(dropPosition === 0 && s.categories.find((c) => c.id === dropNode.key)?.isVat)}
              onDrop={onDrop}
              onSelect={(keys) => keys[0] && setEditing({ mode: 'edit', id: String(keys[0]) })}
              selectedKeys={editing?.mode === 'edit' ? [editing.id] : []}
            />
          </section>
        ))}
      </div>

      <CategoryDrawer
        editing={editing}
        category={editingCat}
        mayEdit={mayEdit}
        onClose={() => setEditing(null)}
        onAddChild={(c) => setEditing({ mode: 'create', flow: c.flow, parentId: c.id })}
        onMerge={(c) => setRelocate({ id: c.id, mode: 'merge' })}
        onDelete={async (c) => {
          const children = s.categories.some((k) => k.parentId === c.id);
          const used =
            s.transactions.some((t) => t.categoryId === c.id) ||
            s.commitments.some((k) => k.categoryId === c.id) ||
            s.budgets.some((b) => b.categoryId === c.id) ||
            s.rules.some((r) => r.categoryId === c.id);
          if (children || used) {
            setRelocate({ id: c.id, mode: 'delete' });
            return;
          }
          modal.confirm({
            title: `Supprimer « ${c.name} » ?`,
            okText: 'Supprimer',
            okButtonProps: { danger: true },
            cancelText: 'Annuler',
            onOk: async () => {
              try {
                await s.deleteCategory(c.id);
                setEditing(null);
                message.success('Catégorie supprimée');
              } catch (e) {
                fail(e);
              }
            },
          });
        }}
      />

      <RelocateModal
        key={relocate ? `${relocate.mode}-${relocate.id}` : 'none'}
        state={relocate}
        busy={busy}
        onCancel={() => setRelocate(null)}
        onConfirm={async (targetId) => {
          if (!relocate) return;
          setBusy(true);
          try {
            if (relocate.mode === 'merge') await s.mergeCategory(relocate.id, targetId);
            else await s.deleteCategory(relocate.id, targetId);
            message.success(relocate.mode === 'merge' ? 'Catégories fusionnées' : 'Catégorie supprimée, son contenu a été déplacé');
            setRelocate(null);
            setEditing(null);
          } catch (e) {
            fail(e);
          } finally {
            setBusy(false);
          }
        }}
      />
    </div>
  );
}

function CategoryRow({ c, count }: { c: Category; count: number }) {
  const icon = c.icon ? CATEGORY_ICONS[c.icon]?.icon : null;
  return (
    <span className="cat-row">
      <span className="cat-badge" style={{ background: c.color ?? 'var(--opt-border)', color: c.color ? '#fff' : 'var(--opt-text-muted)' }} aria-hidden="true">
        {icon ?? c.name.slice(0, 1).toUpperCase()}
      </span>
      <span className="cat-name">{c.name}</span>
      {c.isVat && (
        <Tooltip title="Utilisée pour vos paiements et l’estimation de TVA.">
          <Tag color="processing">Catégorie de la TVA</Tag>
        </Tooltip>
      )}
      {c.kind !== 'none' && <Tag className="kind-tag">{KIND_LABELS[c.kind]}</Tag>}
      {c.vatRate > 0 && <Tag>{c.vatRate.toLocaleString('fr-FR')} %</Tag>}
      {c.budgetAtParent && <Tag>Budget global</Tag>}
      <span className="muted cat-count">{count ? `${count} op.` : ''}</span>
    </span>
  );
}

interface DrawerProps {
  editing: Editing;
  category: Category | undefined;
  mayEdit: boolean;
  onClose: () => void;
  onAddChild: (c: Category) => void;
  onMerge: (c: Category) => void;
  onDelete: (c: Category) => void;
}

interface Values {
  name: string;
  icon: string | null;
  color: string | null;
  note: string;
  vatRate: number;
  kind: CategoryKind;
  defaultAccountId: string | null;
  applyAccountToOpenInvoices: boolean;
  budgetAtParent: boolean;
}

function CategoryDrawer({ editing, category, mayEdit, onClose, onAddChild, onMerge, onDelete }: DrawerProps) {
  const { message } = App.useApp();
  const s = useStore();
  const [form] = Form.useForm<Values>();
  const [saving, setSaving] = useState(false);
  const open = editing !== null;
  const flow = category?.flow ?? (editing?.mode === 'create' ? editing.flow : 'out');
  const parent = editing?.mode === 'create' ? s.categories.find((c) => c.id === editing.parentId) : category?.parentId ? s.categories.find((c) => c.id === category.parentId) : undefined;
  const children = category ? s.categories.some((c) => c.parentId === category.id) : false;
  const byId = new Map(s.categories.map((c) => [c.id, c]));
  const inherited = parent ? effectiveKind(parent, byId) : 'none';
  const openInvoices = category ? s.commitments.filter((c) => c.categoryId === category.id && c.status === 'pending').length : 0;
  const accountChanged = Form.useWatch('defaultAccountId', form) !== (category?.defaultAccountId ?? null);

  const initial: Values = category
    ? {
        name: category.name,
        icon: category.icon ?? null,
        color: category.color ?? null,
        note: category.note ?? '',
        vatRate: category.vatRate,
        kind: category.kind,
        defaultAccountId: category.defaultAccountId ?? null,
        applyAccountToOpenInvoices: false,
        budgetAtParent: category.budgetAtParent,
      }
    : { name: '', icon: null, color: null, note: '', vatRate: parent?.vatRate ?? 0, kind: 'none', defaultAccountId: null, applyAccountToOpenInvoices: false, budgetAtParent: false };

  const submit = async (v: Values) => {
    setSaving(true);
    try {
      if (editing?.mode === 'create') {
        await s.createCategory({ name: v.name.trim(), flow, parentId: editing.parentId, kind: v.kind, vatRate: v.vatRate, icon: v.icon, color: v.color, note: v.note });
        message.success('Catégorie ajoutée');
        onClose();
      } else if (category) {
        const n = await s.updateCategory(category.id, {
          name: v.name.trim(),
          kind: v.kind,
          vatRate: v.vatRate,
          icon: v.icon,
          color: v.color,
          note: v.note || null,
          ...(children ? { budgetAtParent: v.budgetAtParent } : {}),
          ...(accountChanged ? { defaultAccountId: v.defaultAccountId, applyAccountToOpenInvoices: v.applyAccountToOpenInvoices } : {}),
        });
        message.success(n ? `Catégorie modifiée · compte reporté sur ${n} facture${n > 1 ? 's' : ''}` : 'Catégorie modifiée');
        onClose();
      }
    } catch (e) {
      message.error(e instanceof ApiError ? e.message : "La catégorie n'a pas pu être enregistrée.");
    } finally {
      setSaving(false);
    }
  };

  const title = editing?.mode === 'create' ? (parent ? `Nouvelle sous-catégorie de ${parent.name}` : `Nouvelle catégorie · ${flow === 'in' ? 'encaissement' : 'décaissement'}`) : (category?.name ?? '');

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={480}
      title={title}
      destroyOnHidden
      footer={
        mayEdit && (
          <div className="drawer-footer">
            <Button onClick={onClose}>Annuler</Button>
            <Button type="primary" loading={saving} onClick={() => form.submit()}>
              {editing?.mode === 'create' ? 'Ajouter' : 'Enregistrer'}
            </Button>
          </div>
        )
      }
    >
      {open && (
        <Form form={form} layout="vertical" initialValues={initial} onFinish={submit} requiredMark={false} disabled={!mayEdit} key={editing?.mode === 'edit' ? editing.id : 'new'}>
          {category?.isVat && <p className="muted">Catégorie de la TVA : utilisée pour vos paiements et l’estimation de TVA du plan.</p>}
          <Form.Item name="name" label="Nom" rules={[{ required: true, whitespace: true, message: 'Donnez un nom à la catégorie.' }]}>
            <Input maxLength={80} autoFocus />
          </Form.Item>
          <div className="form-row">
            <Form.Item name="icon" label="Icône">
              <Select
                allowClear
                placeholder="Aucune"
                options={Object.entries(CATEGORY_ICONS).map(([k, v]) => ({
                  value: k,
                  label: (
                    <span className="icon-opt">
                      {v.icon} {v.label}
                    </span>
                  ),
                }))}
              />
            </Form.Item>
            <Form.Item name="color" label="Couleur">
              <Radio.Group className="color-swatches">
                {COLORS.map((c) => (
                  <Radio.Button key={c} value={c} aria-label={c}>
                    <span style={{ background: c }} />
                  </Radio.Button>
                ))}
              </Radio.Group>
            </Form.Item>
          </div>
          <Form.Item name="kind" label="Type" extra="Le type alimente les indicateurs d’analyse ; il s’applique aussi aux sous-catégories.">
            <Radio.Group
              options={KIND_OPTIONS.filter((k) => (flow === 'out' ? k !== 'revenue' : k === 'revenue' || k === 'none')).map((k) => ({
                value: k,
                label: k === 'none' && inherited !== 'none' ? `Comme la catégorie parente (${KIND_LABELS[inherited]})` : KIND_LABELS[k],
              }))}
            />
          </Form.Item>
          <Form.Item name="vatRate" label="Taux de TVA par défaut">
            <Select options={VAT_RATES.map((r) => ({ value: r, label: `${r.toLocaleString('fr-FR')} %` }))} style={{ maxWidth: 160 }} />
          </Form.Item>
          {editing?.mode === 'edit' && (
            <>
              <Form.Item name="defaultAccountId" label="Compte par défaut des factures" extra="Si vide : catégorie parente, puis compte par défaut des engagements.">
                <Select allowClear placeholder="Aucun" options={s.accounts.map((a) => ({ value: a.id, label: a.displayName || a.name }))} />
              </Form.Item>
              {accountChanged && openInvoices > 0 && (
                <Form.Item name="applyAccountToOpenInvoices" valuePropName="checked">
                  <Checkbox>
                    Appliquer aux {openInvoices} facture{openInvoices > 1 ? 's' : ''} non payée{openInvoices > 1 ? 's' : ''} de cette catégorie
                  </Checkbox>
                </Form.Item>
              )}
              {children && (
                <Form.Item
                  name="budgetAtParent"
                  label="Budget saisi au niveau de cette catégorie"
                  valuePropName="checked"
                  extra="Activé : vous saisissez un seul budget pour l’ensemble ; les sous-catégories servent à classer les opérations. Désactivé : le budget est la somme des sous-catégories."
                >
                  <Switch />
                </Form.Item>
              )}
            </>
          )}
          <Form.Item name="note" label="Note">
            <Input.TextArea maxLength={500} autoSize={{ minRows: 2, maxRows: 5 }} />
          </Form.Item>
          {category && mayEdit && (
            <div className="category-actions">
              {!category.isVat && (
                <Button icon={<PlusOutlined />} onClick={() => onAddChild(category)}>
                  Ajouter une sous-catégorie
                </Button>
              )}
              {!category.isVat && !category.isSystem && <Button onClick={() => onMerge(category)}>Fusionner avec…</Button>}
              {!category.isVat && !category.isSystem && (
                <Button danger onClick={() => onDelete(category)}>
                  Supprimer
                </Button>
              )}
            </div>
          )}
        </Form>
      )}
    </Drawer>
  );
}

function RelocateModal({
  state,
  busy,
  onCancel,
  onConfirm,
}: {
  state: { id: string; mode: 'merge' | 'delete' } | null;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (targetId: string) => void;
}) {
  const s = useStore();
  const [target, setTarget] = useState<string | undefined>();
  const cat = state ? s.categories.find((c) => c.id === state.id) : undefined;
  if (!state || !cat) return null;
  const excluded = new Set(subtreeIds(s.categories, cat.id));
  const options = s.categories.filter((c) => c.flow === cat.flow && !excluded.has(c.id)).map((c) => ({ value: c.id, label: c.name }));
  const n = {
    tx: s.transactions.filter((t) => t.categoryId === cat.id).length,
    inv: s.commitments.filter((c) => c.categoryId === cat.id).length,
    sub: s.categories.filter((c) => c.parentId === cat.id).length,
  };
  return (
    <Modal
      open
      title={state.mode === 'merge' ? `Fusionner « ${cat.name} » avec…` : `Supprimer « ${cat.name} »`}
      okText={state.mode === 'merge' ? 'Fusionner' : 'Déplacer et supprimer'}
      okButtonProps={{ disabled: !target, danger: state.mode === 'delete', loading: busy }}
      cancelText="Annuler"
      onCancel={() => {
        setTarget(undefined);
        onCancel();
      }}
      onOk={() => target && onConfirm(target)}
    >
      <p>
        {[n.tx && `${n.tx} opération${n.tx > 1 ? 's' : ''}`, n.inv && `${n.inv} facture${n.inv > 1 ? 's' : ''}`, n.sub && `${n.sub} sous-catégorie${n.sub > 1 ? 's' : ''}`, 'les budgets et les règles']
          .filter(Boolean)
          .join(', ')}{' '}
        {state.mode === 'merge' ? 'rejoindront la catégorie choisie, puis' : 'seront déplacés vers la catégorie choisie, puis'} « {cat.name} » sera supprimée. Les budgets s’additionnent.
      </p>
      <Select showSearch optionFilterProp="label" placeholder="Déplacer vers…" value={target} onChange={setTarget} options={options} style={{ width: '100%' }} />
    </Modal>
  );
}
