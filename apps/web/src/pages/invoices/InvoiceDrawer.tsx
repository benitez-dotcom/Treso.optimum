/** Création et modification d'une facture (écran 7.8, drawer). */
import { useEffect, useMemo, useState } from 'react';
import { App, AutoComplete, Button, DatePicker, Drawer, Form, Input, InputNumber, Radio, Select, Switch } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import {
  counterpartyDefaults,
  dueFromTerms,
  FREQUENCIES,
  invoiceAccount,
  PAYMENT_TERMS,
  seriesDates,
  termsFromDates,
  vatOf,
  type Commitment,
  type Flow,
  type Frequency,
  type PaymentTerms,
  type SeriesScope,
} from '@optimum/treso-engine';
import { useStore, type CommitmentPatch } from '../../store/useStore';
import { accountLabel } from '../../api/types';
import { CategorySelect } from '../../components/CategorySelect';

const VAT_RATES = [0, 2.1, 5.5, 10, 20];
const iso = (d: Dayjs) => d.format('YYYY-MM-DD');

interface Values {
  counterparty: string;
  number?: string;
  label?: string;
  categoryId: string | null;
  amountInclTax: number | null;
  vatRate: number;
  vatAmount: number | null;
  issuedAt: Dayjs;
  paymentTerms: PaymentTerms;
  dueAt: Dayjs;
  accountId?: string | null;
  note?: string;
  repeat: boolean;
  frequency: Frequency;
  customMonths: number;
  limit: 'count' | 'end';
  count: number;
  endDate?: Dayjs;
}

interface Props {
  open: boolean;
  flow: Flow;
  invoice: Commitment | null;
  onClose: () => void;
}

/** Choix « Cette échéance seulement / Cette échéance et les suivantes ». */
export function askScope(modal: ReturnType<typeof App.useApp>['modal'], title: string, okText: string, danger = false): Promise<SeriesScope | null> {
  return new Promise((resolve) => {
    let scope: SeriesScope = 'one';
    const m = modal.confirm({
      title,
      icon: null,
      content: (
        <Radio.Group defaultValue="one" onChange={(e) => (scope = e.target.value)} className="scope-choice">
          <Radio value="one">Cette échéance seulement</Radio>
          <Radio value="following">Cette échéance et les suivantes</Radio>
        </Radio.Group>
      ),
      okText,
      okButtonProps: { danger },
      cancelText: 'Annuler',
      onOk: () => resolve(scope),
      onCancel: () => resolve(null),
    });
    void m;
  });
}

export function InvoiceDrawer({ open, flow, invoice, onClose }: Props) {
  const { message, modal } = App.useApp();
  const [form] = Form.useForm<Values>();
  const commitments = useStore((s) => s.commitments);
  const categories = useStore((s) => s.categories);
  const accounts = useStore((s) => s.accounts);
  const today = useStore((s) => s.today);
  const createCommitments = useStore((s) => s.createCommitments);
  const updateCommitment = useStore((s) => s.updateCommitment);
  const deleteCommitment = useStore((s) => s.deleteCommitment);
  const [vatTouched, setVatTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const locked = invoice?.source === 'integration';

  const known = useMemo(() => counterpartyDefaults(commitments, flow), [commitments, flow]);

  useEffect(() => {
    if (!open) return;
    setVatTouched(false);
    form.resetFields();
    if (invoice) {
      form.setFieldsValue({
        counterparty: invoice.counterparty,
        number: invoice.number ?? '',
        label: invoice.label,
        categoryId: invoice.categoryId,
        amountInclTax: invoice.amountInclTax,
        vatRate: invoice.vatRate,
        vatAmount: invoice.vatAmount ?? vatOf(invoice.amountInclTax, invoice.vatRate),
        issuedAt: dayjs(invoice.issuedAt),
        paymentTerms: invoice.paymentTerms ?? termsFromDates(invoice.issuedAt, invoice.dueAt),
        dueAt: dayjs(invoice.dueAt),
        accountId: invoice.accountId ?? null,
        note: invoice.note ?? '',
        repeat: false,
      });
      setVatTouched(invoice.vatAmount != null);
    } else {
      form.setFieldsValue({
        issuedAt: dayjs(today),
        paymentTerms: 'd30',
        dueAt: dayjs(dueFromTerms(today, 'd30')!),
        vatRate: 20,
        repeat: false,
        frequency: 'monthly',
        customMonths: 1,
        limit: 'count',
        count: 12,
        categoryId: null,
        amountInclTax: null,
        vatAmount: null,
      });
    }
  }, [open, invoice, form, today]);

  const recalcVat = () => {
    if (vatTouched) return;
    const { amountInclTax, vatRate } = form.getFieldsValue(['amountInclTax', 'vatRate']);
    form.setFieldValue('vatAmount', amountInclTax ? vatOf(amountInclTax, vatRate ?? 0) : null);
  };
  const recalcDue = () => {
    const { issuedAt, paymentTerms } = form.getFieldsValue(['issuedAt', 'paymentTerms']);
    if (!issuedAt) return;
    const due = dueFromTerms(iso(issuedAt), paymentTerms);
    if (due) form.setFieldValue('dueAt', dayjs(due));
  };

  const pickCounterparty = (name: string) => {
    // Tiers tapé en entier sans choisir dans la liste : on le reconnaît quand même
    const d = known.find((k) => k.name.trim().toLocaleLowerCase('fr') === name.trim().toLocaleLowerCase('fr'));
    if (!d) return;
    const patch: Partial<Values> = { vatRate: d.vatRate, paymentTerms: d.paymentTerms };
    if (d.categoryId && !form.getFieldValue('categoryId')) patch.categoryId = d.categoryId;
    if (d.accountId) patch.accountId = d.accountId;
    form.setFieldsValue(patch);
    recalcDue();
    recalcVat();
  };

  const onCategory = (id: string | null) => {
    form.setFieldValue('categoryId', id);
    const cat = categories.find((c) => c.id === id);
    if (cat && !invoice) {
      form.setFieldValue('vatRate', cat.vatRate);
      recalcVat();
    }
  };

  const v = Form.useWatch([], form) as Partial<Values> | undefined;
  const cascade = useMemo(() => {
    const defaultAccountId = accounts.find((a) => a.isDefaultForCommitments)?.id ?? null;
    const r = invoiceAccount(
      { id: invoice?.id ?? '_new', accountId: null, counterparty: v?.counterparty ?? '', categoryId: v?.categoryId ?? null },
      { commitments, categories, defaultAccountId },
    );
    const a = accounts.find((x) => x.id === r.accountId);
    return a ? `Par défaut : ${accountLabel(a)}` : 'Aucun compte par défaut';
  }, [v?.counterparty, v?.categoryId, accounts, commitments, categories, invoice]);

  const occurrences = useMemo(() => {
    if (!v?.repeat || !v.dueAt) return 0;
    const months = v.frequency === 'custom' ? v.customMonths ?? 1 : (FREQUENCIES.find((f) => f.value === v.frequency)?.months ?? 1);
    try {
      return seriesDates(iso(v.dueAt), months, v.limit === 'end' ? { endDate: v.endDate ? iso(v.endDate) : null } : { count: v.count ?? 1 }).length;
    } catch {
      return 0;
    }
  }, [v?.repeat, v?.dueAt, v?.frequency, v?.customMonths, v?.limit, v?.count, v?.endDate]);

  const submit = async (val: Values) => {
    setSaving(true);
    try {
      const common = {
        counterparty: val.counterparty.trim(),
        number: val.number?.trim() || null,
        label: val.label?.trim() || undefined,
        categoryId: val.categoryId!,
        amountInclTax: val.amountInclTax!,
        vatRate: val.vatRate,
        vatAmount: vatTouched ? val.vatAmount : null,
        issuedAt: iso(val.issuedAt),
        paymentTerms: val.paymentTerms,
        dueAt: iso(val.dueAt),
        accountId: val.accountId || null,
        note: val.note?.trim() || null,
      };
      if (invoice) {
        let scope: SeriesScope = 'one';
        if (invoice.seriesId) {
          const s = await askScope(modal, 'Modifier une échéance récurrente', 'Enregistrer');
          if (!s) return;
          scope = s;
        }
        const patch: CommitmentPatch = { ...common, label: common.label ?? invoice.label };
        if (locked) {
          delete patch.amountInclTax;
          delete patch.vatRate;
        }
        const res = await updateCommitment(invoice.id, patch, scope);
        message.success(res.length > 1 ? `${res.length} échéances modifiées` : 'Facture enregistrée');
      } else {
        const months = val.frequency === 'custom' ? val.customMonths : (FREQUENCIES.find((f) => f.value === val.frequency)?.months ?? 1);
        const created = await createCommitments({
          flow,
          ...common,
          repeat: val.repeat ? { intervalMonths: months, ...(val.limit === 'end' ? { endDate: val.endDate ? iso(val.endDate) : null } : { count: val.count }) } : null,
        });
        message.success(created.length > 1 ? `${created.length} échéances créées` : 'Facture créée');
      }
      onClose();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "La facture n'a pas pu être enregistrée.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!invoice) return;
    let scope: SeriesScope = 'one';
    if (invoice.seriesId) {
      const s = await askScope(modal, 'Supprimer une échéance récurrente', 'Supprimer', true);
      if (!s) return;
      scope = s;
    } else {
      const ok = await confirmAsync(modal, `Supprimer la facture ${invoice.number ?? invoice.counterparty} ?`);
      if (!ok) return;
    }
    try {
      const n = await deleteCommitment(invoice.id, scope);
      message.success(n > 1 ? `${n} échéances supprimées` : 'Facture supprimée');
      onClose();
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Suppression impossible.');
    }
  };

  const title = invoice ? `${flow === 'in' ? 'Facture client' : 'Facture fournisseur'}${invoice.number ? ` ${invoice.number}` : ''}` : flow === 'in' ? 'Nouvelle facture client' : 'Nouvelle facture fournisseur';

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={520}
      title={title}
      destroyOnHidden
      footer={
        <div className="drawer-footer">
          {invoice && !locked && (
            <Button danger onClick={remove} style={{ marginRight: 'auto' }}>
              Supprimer
            </Button>
          )}
          <Button onClick={onClose}>Annuler</Button>
          <Button type="primary" loading={saving} onClick={() => form.submit()}>
            {invoice ? 'Enregistrer' : 'Créer la facture'}
          </Button>
        </div>
      }
    >
      {locked && <p className="muted">Facture synchronisée depuis votre logiciel de facturation : le montant et la suppression se gèrent dans ce logiciel.</p>}
      <Form form={form} layout="vertical" requiredMark={false} onFinish={submit} className="invoice-form">
        <Form.Item name="counterparty" label={flow === 'in' ? 'Client' : 'Fournisseur'} rules={[{ required: true, whitespace: true, message: 'Indiquez le tiers.' }]}>
          <AutoComplete
            options={known.map((k) => ({ value: k.name }))}
            filterOption={(input, o) => String(o?.value ?? '').toLowerCase().includes(input.toLowerCase())}
            onSelect={pickCounterparty}
            onBlur={() => !invoice && pickCounterparty(String(form.getFieldValue('counterparty') ?? ''))}
            placeholder={flow === 'in' ? 'Ex. : Studio Lumen' : 'Ex. : Bois & Matériaux'}
            autoFocus
          />
        </Form.Item>
        <div className="form-row">
          <Form.Item name="number" label="Numéro">
            <Input placeholder="FA-2026-112" maxLength={60} />
          </Form.Item>
          <Form.Item name="label" label="Libellé">
            <Input placeholder="Facultatif" maxLength={200} />
          </Form.Item>
        </div>
        <Form.Item name="categoryId" label="Catégorie" rules={[{ required: true, message: 'Choisissez une catégorie.' }]}>
          <CategorySelect flow={flow} value={v?.categoryId ?? null} onChange={onCategory} ariaLabel="Catégorie" placeholder="Choisir une catégorie" allowClear={false} />
        </Form.Item>
        <div className="form-row">
          <Form.Item name="amountInclTax" label="Montant TTC" rules={[{ required: true, message: 'Indiquez le montant TTC' }]}>
            <InputNumber min={0.01} step={10} decimalSeparator="," suffix="€" style={{ width: '100%' }} onChange={recalcVat} disabled={locked} />
          </Form.Item>
          <Form.Item name="vatRate" label="Taux de TVA">
            <Select options={VAT_RATES.map((r) => ({ value: r, label: `${String(r).replace('.', ',')} %` }))} onChange={recalcVat} disabled={locked} />
          </Form.Item>
          <Form.Item name="vatAmount" label="Montant TVA">
            <InputNumber min={0} decimalSeparator="," suffix="€" style={{ width: '100%' }} onChange={() => setVatTouched(true)} />
          </Form.Item>
        </div>
        <div className="form-row">
          <Form.Item name="issuedAt" label="Date d’émission" rules={[{ required: true }]}>
            <DatePicker format="DD/MM/YYYY" allowClear={false} style={{ width: '100%' }} onChange={recalcDue} />
          </Form.Item>
          <Form.Item name="paymentTerms" label="Délai de paiement">
            <Select options={PAYMENT_TERMS} onChange={recalcDue} />
          </Form.Item>
          <Form.Item name="dueAt" label="Échéance" rules={[{ required: true, message: 'Indiquez l’échéance.' }]}>
            <DatePicker
              format="DD/MM/YYYY"
              allowClear={false}
              style={{ width: '100%' }}
              onChange={(d) => d && form.setFieldValue('paymentTerms', termsFromDates(iso(form.getFieldValue('issuedAt')), iso(d)))}
            />
          </Form.Item>
        </div>
        <Form.Item name="accountId" label="Compte" extra="Compte sur lequel le paiement est attendu. Pré-rempli depuis la catégorie.">
          <Select allowClear placeholder={cascade} options={accounts.map((a) => ({ value: a.id, label: `${accountLabel(a)}${a.bankName ? ` · ${a.bankName}` : ''}` }))} />
        </Form.Item>
        {!invoice && (
          <>
            <Form.Item name="repeat" label="Répéter" valuePropName="checked" extra="Crée automatiquement les prochaines échéances.">
              <Switch />
            </Form.Item>
            {v?.repeat && (
              <div className="repeat-box">
                <div className="form-row">
                  <Form.Item name="frequency" label="Fréquence">
                    <Select options={FREQUENCIES.map((f) => ({ value: f.value, label: f.label }))} />
                  </Form.Item>
                  {v.frequency === 'custom' && (
                    <Form.Item name="customMonths" label="Tous les">
                      <InputNumber min={1} max={24} suffix="mois" style={{ width: '100%' }} />
                    </Form.Item>
                  )}
                </div>
                <Form.Item name="limit">
                  <Radio.Group>
                    <Radio value="count">Nombre d’échéances</Radio>
                    <Radio value="end">Date de fin</Radio>
                  </Radio.Group>
                </Form.Item>
                {v.limit === 'end' ? (
                  <Form.Item name="endDate" rules={[{ required: true, message: 'Indiquez la date de fin.' }]}>
                    <DatePicker format="DD/MM/YYYY" style={{ width: 200 }} />
                  </Form.Item>
                ) : (
                  <Form.Item name="count" rules={[{ required: true, type: 'number', min: 1, max: 120, message: 'Entre 1 et 120 échéances.' }]}>
                    <InputNumber min={1} max={120} style={{ width: 200 }} suffix="échéances" />
                  </Form.Item>
                )}
                <p className="muted">{occurrences > 0 ? `${occurrences} échéance${occurrences > 1 ? 's' : ''} seront créées.` : 'Aucune échéance avec ces réglages.'}</p>
              </div>
            )}
          </>
        )}
        <Form.Item name="note" label="Note">
          <Input.TextArea autoSize={{ minRows: 2, maxRows: 5 }} maxLength={2000} />
        </Form.Item>
      </Form>
    </Drawer>
  );
}

/** Confirmation simple promisifiée (Modal.confirm d'Ant Design renvoie une promesse de fermeture). */
export const confirmAsync = (modal: ReturnType<typeof App.useApp>['modal'], title: string, content?: string) =>
  new Promise<boolean>((resolve) =>
    modal.confirm({ title, content, okText: 'Confirmer', cancelText: 'Annuler', onOk: () => resolve(true), onCancel: () => resolve(false) }),
  );

