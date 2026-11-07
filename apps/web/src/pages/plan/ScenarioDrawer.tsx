/** Créer ou modifier un scénario (nom, description, couleur, point de départ). */
import { useEffect } from 'react';
import { App, Button, Drawer, Form, Input, Radio, Select } from 'antd';
import type { Scenario } from '@optimum/treso-engine';
import { useStore } from '../../store/useStore';
import { SCENARIO_COLORS } from './format';

interface Props {
  open: boolean;
  /** Scénario modifié ; absent = création. */
  scenario: Scenario | null;
  scenarios: Scenario[];
  limitReached: boolean;
  onClose: () => void;
  onCreated: (id: string) => void;
}

interface Values {
  name: string;
  description?: string;
  color: string;
  start: string;
}

export function ScenarioDrawer({ open, scenario, scenarios, limitReached, onClose, onCreated }: Props) {
  const { message } = App.useApp();
  const [form] = Form.useForm<Values>();
  const addScenario = useStore((s) => s.addScenario);
  const updateScenario = useStore((s) => s.updateScenario);

  useEffect(() => {
    if (!open) return;
    const used = new Set(scenarios.map((s) => s.color));
    form.setFieldsValue(
      scenario
        ? { name: scenario.name, description: scenario.description ?? '', color: scenario.color, start: 'base' }
        : { name: '', description: '', color: (SCENARIO_COLORS.find((c) => !used.has(c.value)) ?? SCENARIO_COLORS[0]!).value, start: 'base' },
    );
  }, [open, scenario, scenarios, form]);

  const submit = async (v: Values) => {
    try {
      if (scenario) {
        await updateScenario(scenario.id, { name: v.name.trim(), color: v.color, description: v.description?.trim() || null });
        message.success('Scénario modifié');
        onClose();
      } else {
        const id = await addScenario(v.name.trim(), v.color, v.start === 'base' ? undefined : v.start, v.description?.trim());
        message.success(`Scénario « ${v.name.trim()} » créé. Modifiez uniquement les valeurs qui changent.`);
        onCreated(id);
      }
    } catch (e) {
      message.error(e instanceof Error ? e.message : "Le scénario n'a pas pu être enregistré.");
    }
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={440}
      title={scenario ? 'Modifier le scénario' : 'Créer un scénario'}
      destroyOnHidden
      footer={
        <div className="drawer-footer">
          <Button onClick={onClose}>Annuler</Button>
          <Button type="primary" onClick={() => form.submit()} disabled={!scenario && limitReached}>
            {scenario ? 'Enregistrer' : 'Créer le scénario'}
          </Button>
        </div>
      }
    >
      {!scenario && (
        <p className="muted">
          Votre scénario reprend toutes les valeurs du scénario de base. Modifiez uniquement ce qui change : le reste suit automatiquement.
        </p>
      )}
      {!scenario && limitReached && (
        <p className="warn-text">Votre offre inclut 1 scénario alternatif. Passez à Performance pour en créer d’autres.</p>
      )}
      <Form form={form} layout="vertical" onFinish={submit} requiredMark={false}>
        <Form.Item name="name" label="Nom" rules={[{ required: true, whitespace: true, message: 'Donnez un nom à votre scénario.' }]}>
          <Input placeholder="Ex. : Recrutement commercial en mars" maxLength={80} autoFocus />
        </Form.Item>
        <Form.Item name="description" label="Description">
          <Input.TextArea placeholder="Hypothèses de ce scénario" maxLength={500} autoSize={{ minRows: 2, maxRows: 5 }} />
        </Form.Item>
        {!scenario?.isBase && (
          <Form.Item name="color" label="Couleur">
            <Radio.Group className="color-choices">
              {SCENARIO_COLORS.map((c) => (
                <Radio.Button key={c.value} value={c.value} aria-label={c.label} title={c.label}>
                  <span className="scenario-dot lg" style={{ background: c.value }} />
                </Radio.Button>
              ))}
            </Radio.Group>
          </Form.Item>
        )}
        {!scenario && (
          <Form.Item name="start" label="Point de départ">
            <Select
              options={[
                { value: 'base', label: 'Scénario de base' },
                ...scenarios.filter((s) => !s.isBase).map((s) => ({ value: s.id, label: `Copie de « ${s.name} »` })),
              ]}
            />
          </Form.Item>
        )}
      </Form>
    </Drawer>
  );
}
