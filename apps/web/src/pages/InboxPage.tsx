import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { App, Button, Progress, Segmented, Select } from 'antd';
import { CheckOutlined, LinkOutlined } from '@ant-design/icons';
import { formatDate, formatEuro, formatEuroRounded, normalizeLabel } from '@optimum/treso-engine';
import { useStore } from '../store/useStore';
import { canWrite } from '../api/types';
import { Alert } from 'antd';
import { useCategoryOptions, useInbox, type InboxItem } from '../store/selectors';
import { MotifStrip } from '../layout/Brand';
import './inbox.css';

type Filter = 'all' | 'group' | 'reconciliation' | 'overdue';

const sourceLabel: Record<string, string> = { rule: 'Règle', similar: 'Similaire', ai: 'Suggestion IA' };
const confidenceLabel: Record<string, string> = { high: 'sûr', medium: 'probable', low: 'incertain' };

function initials(name: string) {
  return name
    .replace(/[^A-Za-zÀ-ÿ ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
}

function GroupCard({ item, active, onFocus }: { item: Extract<InboxItem, { kind: 'group' }>; active: boolean; onFocus: () => void }) {
  const { message } = App.useApp();
  const categorize = useStore((s) => s.categorize);
  const setHidden = useStore((s) => s.setHidden);
  const undo = useStore((s) => s.undo);
  const addRule = useStore((s) => s.addRule);
  const categories = useStore((s) => s.categories);
  const flow = item.total >= 0 ? 'in' : 'out';
  const options = useCategoryOptions(flow);
  const [choice, setChoice] = useState<string | null>(item.suggestedCategoryId);
  const selectRef = useRef<{ focus: () => void } | null>(null);
  const first = item.transactions[0]!;
  const count = item.transactions.length;

  const validate = () => {
    if (!choice) {
      selectRef.current?.focus();
      message.warning('Choisissez d\'abord une catégorie.');
      return;
    }
    const catName = categories.find((c) => c.id === choice)?.name ?? '';
    const similar = categorize(item.transactions.map((t) => t.id), choice);
    const manual = choice !== item.suggestedCategoryId || item.source !== 'rule';
    const key = `cat-${item.key}`;
    message.open({
      key,
      type: 'success',
      duration: 8,
      content: (
        <span className="toast">
          {count > 1 ? `${count} opérations catégorisées` : 'Catégorisée'} en {catName}
          {similar.length > 0 && ` · ${similar.length} similaire${similar.length > 1 ? 's' : ''} restante${similar.length > 1 ? 's' : ''}`}
          {manual && (
            <button
              type="button"
              className="toast-action"
              onClick={() => {
                addRule({
                  conditions: [{ field: 'label', op: 'contains', value: normalizeLabel(first.rawLabel).split(' ').slice(0, 3).join(' ') }],
                  categoryId: choice,
                  autoApply: true,
                  priority: 5,
                });
                message.open({ key, type: 'success', content: `Règle créée : « ${item.counterparty} » ira toujours en ${catName}.` });
              }}
            >
              Toujours classer ainsi
            </button>
          )}
          <button type="button" className="toast-action" onClick={() => { undo(); message.destroy(key); }}>
            Annuler
          </button>
        </span>
      ),
    });
  };

  const exclude = () => {
    setHidden(item.transactions.map((t) => t.id), true);
    const key = `hide-${item.key}`;
    message.open({
      key,
      type: 'info',
      duration: 8,
      content: (
        <span className="toast">
          Exclue des totaux
          <button type="button" className="toast-action" onClick={() => { undo(); message.destroy(key); }}>Annuler</button>
        </span>
      ),
    });
  };

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('input, textarea, .ant-select')) return;
      if (e.key === 'Enter') { e.preventDefault(); validate(); }
      if (e.key.toLowerCase() === 'c') { e.preventDefault(); selectRef.current?.focus(); }
      if (e.key.toLowerCase() === 'x') { e.preventDefault(); exclude(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <article className={`inbox-card${active ? ' active' : ''}`} onClick={onFocus} aria-current={active ? 'true' : undefined}>
      <div className="inbox-head">
        <span className="inbox-avatar" aria-hidden="true">{initials(item.counterparty)}</span>
        <div className="inbox-title">
          <strong>{item.counterparty}{count > 1 ? ` · ${count} opérations` : ''}</strong>
          <span className="muted">{count > 1 ? `Du ${formatDate(item.transactions[count - 1]!.bookedAt, false)} au ${formatDate(first.bookedAt, false)}` : `${first.rawLabel} · ${formatDate(first.bookedAt, false)}`}</span>
        </div>
        <strong className={`num inbox-amount${item.total > 0 ? ' positive' : ''}`}>{item.total > 0 ? '+' : ''}{formatEuro(item.total)}</strong>
      </div>
      <div className="inbox-suggestion">
        <span className="muted">{item.suggestedCategoryId ? 'Suggestion' : 'Catégorie'}</span>
        <Select
          ref={selectRef as never}
          className="inbox-select"
          showSearch
          placeholder="Choisir une catégorie"
          value={choice ?? undefined}
          onChange={(v: string) => setChoice(v)}
          options={options}
          optionFilterProp="searchLabel"
          optionLabelProp="searchLabel"
          aria-label={`Catégorie pour ${item.counterparty}`}
          popupMatchSelectWidth={280}
        />
        {item.source && choice === item.suggestedCategoryId && (
          <span className={`badge ${item.confidence === 'high' ? 'ok' : ''}`}>
            {sourceLabel[item.source]} · {confidenceLabel[item.confidence ?? 'low']}
          </span>
        )}
      </div>
      <div className="inbox-actions">
        <Button onClick={exclude}>Exclure <kbd className="kbd">X</kbd></Button>
        <Button type="primary" className={active ? 'cta-orange' : undefined} icon={<CheckOutlined />} onClick={validate}>
          {count > 1 ? `Valider les ${count}` : 'Valider'} {active && <kbd className="kbd on-dark">Entrée</kbd>}
        </Button>
      </div>
    </article>
  );
}

function ReconciliationCard({ item, active, onFocus, onDismiss }: { item: Extract<InboxItem, { kind: 'reconciliation' }>; active: boolean; onFocus: () => void; onDismiss: () => void }) {
  const { message } = App.useApp();
  const confirm = useStore((s) => s.confirmReconciliation);
  const undo = useStore((s) => s.undo);
  const { transaction: t, commitment: c } = item;
  return (
    <article className={`inbox-card${active ? ' active' : ''}`} onClick={onFocus}>
      <div className="inbox-kicker"><LinkOutlined aria-hidden="true" /> Rapprochement suggéré</div>
      <div className="row-between"><span>{t.rawLabel} · {formatDate(t.bookedAt, false)}</span><strong className="num positive">+{formatEuro(t.amount)}</strong></div>
      <div className="row-between muted"><span>Facture {c.number} · {c.counterparty}</span><span className="num">{formatEuro(c.amountInclTax)}</span></div>
      <div className="inbox-actions">
        <Button onClick={onDismiss}>Ce n'est pas ça</Button>
        <Button
          type="primary"
          className={active ? 'cta-orange' : undefined}
          onClick={() => {
            confirm(t.id, c.id);
            const key = `rec-${t.id}`;
            message.open({
              key,
              type: 'success',
              duration: 8,
              content: (
                <span className="toast">
                  Facture {c.number} marquée payée
                  <button type="button" className="toast-action" onClick={() => { undo(); message.destroy(key); }}>Annuler</button>
                </span>
              ),
            });
          }}
        >
          Confirmer
        </Button>
      </div>
    </article>
  );
}

function OverdueCard({ item, active, onFocus }: { item: Extract<InboxItem, { kind: 'overdue' }>; active: boolean; onFocus: () => void }) {
  const { message } = App.useApp();
  const c = item.commitment;
  return (
    <article className={`inbox-card${active ? ' active' : ''}`} onClick={onFocus}>
      <div className="inbox-head">
        <span className="dot-danger" aria-hidden="true" />
        <div className="inbox-title">
          <strong>{c.counterparty} · en retard de {item.days} j</strong>
          <span className="muted">{c.number} · échue le {formatDate(c.dueAt, false)}</span>
        </div>
        <strong className="num inbox-amount">{formatEuroRounded(c.amountInclTax - (c.amountPaid ?? 0))}</strong>
      </div>
      <div className="inbox-actions">
        <Button type={active ? 'primary' : 'default'} className={active ? 'cta-orange' : undefined} onClick={() => message.success(`Email de relance préparé pour ${c.counterparty}. L'envoi arrive avec le lot 4.`)}>
          Relancer le client
        </Button>
      </div>
    </article>
  );
}

export function InboxPage() {
  const items = useInbox();
  const role = useStore((s) => s.role);
  const readOnly = !canWrite(role);
  const [filter, setFilter] = useState<Filter>('all');
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [activeIndex, setActiveIndex] = useState(0);
  const [initialTotal] = useState(() => items.reduce((n, i) => n + (i.kind === 'group' ? i.transactions.length : 1), 0));

  const visible = useMemo(
    () => items.filter((i) => !dismissed.has(i.key) && (filter === 'all' || i.kind === filter)),
    [items, filter, dismissed],
  );
  const counts = useMemo(() => {
    const c = { group: 0, reconciliation: 0, overdue: 0 };
    for (const i of items) if (!dismissed.has(i.key)) c[i.kind] += i.kind === 'group' ? i.transactions.length : 1;
    return c;
  }, [items, dismissed]);
  const remaining = counts.group + counts.reconciliation + counts.overdue;
  const done = Math.max(0, initialTotal - remaining);
  const active = Math.min(activeIndex, Math.max(0, visible.length - 1));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea, .ant-select')) return;
      if (e.key === 'ArrowDown' || e.key === 'j') { e.preventDefault(); setActiveIndex((i) => Math.min(i + 1, visible.length - 1)); }
      if (e.key === 'ArrowUp' || e.key === 'k') { e.preventDefault(); setActiveIndex((i) => Math.max(i - 1, 0)); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [visible.length]);

  return (
    <div className="inbox">
      <div className="inbox-top">
        <Segmented<Filter>
          value={filter}
          onChange={(v) => { setFilter(v); setActiveIndex(0); }}
          options={[
            { value: 'all', label: `Tout · ${remaining}` },
            { value: 'group', label: `À catégoriser · ${counts.group}` },
            { value: 'reconciliation', label: `Rapprochements · ${counts.reconciliation}` },
            { value: 'overdue', label: `Retards · ${counts.overdue}` },
          ]}
        />
        <div className="inbox-progress">
          <span className="muted">{done} traité{done > 1 ? 's' : ''} sur {initialTotal}</span>
          <Progress percent={initialTotal ? Math.round((done / initialTotal) * 100) : 100} showInfo={false} strokeColor="var(--opt-sage)" size="small" />
        </div>
      </div>
      <p className="muted shortcuts">
        Raccourcis : <kbd className="kbd">↑</kbd> <kbd className="kbd">↓</kbd> naviguer · <kbd className="kbd">Entrée</kbd> valider · <kbd className="kbd">C</kbd> changer la catégorie · <kbd className="kbd">X</kbd> exclure des totaux
      </p>

      {readOnly && <Alert type="info" showIcon message="Votre rôle permet de consulter ces éléments, pas de les traiter. Un contributeur ou un administrateur s'en charge." />}
      {visible.length === 0 ? (
        <section className="card inbox-empty">
          <MotifStrip height={64} />
          <div>
            <h2>Tout est à jour. Votre trésorerie est fiable.</h2>
            <p className="muted">Les nouvelles opérations apparaîtront ici dès la prochaine synchronisation.</p>
            <Link to="/plan"><Button type="primary">Voir mon plan de trésorerie</Button></Link>
          </div>
        </section>
      ) : (
        <div className={`inbox-list${readOnly ? ' read-only' : ''}`} inert={readOnly || undefined}>
          {visible.map((item, i) => {
            const isActive = i === active;
            const focus = () => setActiveIndex(i);
            if (item.kind === 'group') return <GroupCard key={item.key} item={item} active={isActive} onFocus={focus} />;
            if (item.kind === 'reconciliation')
              return <ReconciliationCard key={item.key} item={item} active={isActive} onFocus={focus} onDismiss={() => setDismissed((d) => new Set(d).add(item.key))} />;
            return <OverdueCard key={item.key} item={item} active={isActive} onFocus={focus} />;
          })}
        </div>
      )}
    </div>
  );
}
