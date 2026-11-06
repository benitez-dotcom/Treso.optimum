import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Button, Progress, App } from 'antd';
import { WarningOutlined } from '@ant-design/icons';
import {
  addMonths,
  cashAutonomyMonths,
  formatDate,
  formatEuroRounded,
  formatMonthName,
  formatMonthShort,
} from '@optimum/treso-engine';
import { useStore } from '../store/useStore';
import { useSession } from '../api/session';
import { useCurrentBalance, useCurrentMonth, useInbox, usePlan } from '../store/selectors';
import { ChartLegend, TrajectoryChart } from '../components/TrajectoryChart';
import { DecisionDot, MotifStrip } from '../layout/Brand';
import './home.css';

export function HomePage() {
  const { message } = App.useApp();
  const firstName = useSession((s) => s.me?.firstName ?? '');
  const today = useStore((s) => s.today);
  const transactions = useStore((s) => s.transactions);
  const commitments = useStore((s) => s.commitments);
  const scenarios = useStore((s) => s.scenarios);
  const threshold = useStore((s) => s.settings.minCashThreshold);
  const budgets = useStore((s) => s.budgets);
  const balance = useCurrentBalance();
  const current = useCurrentMonth();
  const plan = usePlan(addMonths(current, -3), 9);
  const inbox = useInbox();
  const base = plan.scenarios[plan.baseScenarioId]!;
  const baseScenario = scenarios.find((s) => s.isBase)!;

  const nextMonth = addMonths(current, 1);
  const projected = base.closing[nextMonth] ?? 0;
  const breach = plan.months.find((m) => m >= current && (base.closing[m] ?? Infinity) < threshold);
  const tin = base.totals.in[current]!;
  const tout = base.totals.out[current]!;
  const autonomy = cashAutonomyMonths(balance, transactions, today);

  const counts = useMemo(() => {
    let toCategorize = 0;
    let reconciliations = 0;
    let overdue = 0;
    let overdueAmount = 0;
    for (const i of inbox) {
      if (i.kind === 'group') toCategorize += i.transactions.length;
      if (i.kind === 'reconciliation') reconciliations++;
      if (i.kind === 'overdue') {
        overdue++;
        overdueAmount += i.commitment.amountInclTax - (i.commitment.amountPaid ?? 0);
      }
    }
    return { toCategorize, reconciliations, overdue, overdueAmount, total: toCategorize + reconciliations + overdue };
  }, [inbox]);

  const upcoming = useMemo(
    () =>
      commitments
        .filter((c) => c.status === 'pending' && c.dueAt >= today)
        .sort((a, b) => a.dueAt.localeCompare(b.dueAt))
        .slice(0, 5),
    [commitments, today],
  );

  const hasFutureBudgets = budgets.some((b) => b.scenarioId === baseScenario.id && b.month >= addMonths(current, 2));
  const tips: { text: string; link: string; label: string }[] = [];
  if (counts.overdue > 0) tips.push({ text: `${formatEuroRounded(counts.overdueAmount)} de factures clients sont en retard.`, link: '/a-traiter', label: 'Relancer mes clients' });
  if (breach) tips.push({ text: `Votre trésorerie passera sous votre seuil en ${formatMonthName(breach)}. Anticipez avec un scénario.`, link: '/plan', label: 'Simuler un scénario' });
  if (counts.toCategorize > 0) tips.push({ text: `Catégorisez vos ${counts.toCategorize} opérations pour fiabiliser vos prévisions.`, link: '/a-traiter', label: 'Catégoriser' });
  if (!hasFutureBudgets) tips.push({ text: 'Aucun prévisionnel au-delà du mois prochain. Prolongez vos budgets.', link: '/plan', label: 'Construire mon prévisionnel' });

  const kpis = [
    { label: 'Solde actuel', value: formatEuroRounded(balance), sub: 'Tous les comptes actifs', color: 'var(--opt-text)' },
    { label: `Encaissements de ${formatMonthName(current)}`, value: formatEuroRounded(tin.actual), sub: `sur ${formatEuroRounded(tin.forecast)} prévus`, color: 'var(--opt-in)' },
    { label: `Décaissements de ${formatMonthName(current)}`, value: formatEuroRounded(tout.actual), sub: `sur ${formatEuroRounded(tout.forecast)} prévus`, color: 'var(--opt-text)' },
    { label: 'Autonomie de trésorerie', value: autonomy === null ? '—' : `${autonomy.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} mois`, sub: 'de décaissements couverts', color: 'var(--opt-text)' },
  ];

  const pct = (a: number, b: number) => (b > 0 ? Math.min(100, Math.round((a / b) * 100)) : 0);

  return (
    <>
      <section aria-label="Synthèse" className="home-hero">
        <p className="home-sentence">
          Bonjour {firstName}. Votre trésorerie est de <strong>{formatEuroRounded(balance)}</strong> et devrait atteindre{' '}
          <strong>{formatEuroRounded(projected)}</strong> fin {formatMonthName(nextMonth)}.
        </p>
        {breach && (
          <p className="home-alert">
            <WarningOutlined aria-hidden="true" />
            <span>
              Elle passera sous votre seuil de {formatEuroRounded(threshold)} en {formatMonthName(breach)}.
            </span>
            <Link to="/plan">Voir pourquoi</Link>
          </p>
        )}
      </section>

      <section aria-label="Indicateurs clés" className="kpi-grid">
        {kpis.map((k) => (
          <div key={k.label} className="card kpi">
            <div className="eyebrow">{k.label}</div>
            <div className="kpi-value num" style={{ color: k.color }}>{k.value}</div>
            <div className="kpi-sub">{k.sub}</div>
          </div>
        ))}
      </section>

      <section className="home-row">
        <div className="card trajectory">
          <div className="card-head">
            <h2 className="card-title">Trajectoire</h2>
            <span className="muted">{formatMonthShort(plan.months[0]!)} → {formatMonthShort(plan.months[plan.months.length - 1]!)}</span>
            <Link to="/plan" className="strong-link">Ouvrir le plan</Link>
          </div>
          <TrajectoryChart plan={plan} scenarios={[baseScenario]} threshold={threshold} height={260} />
          <ChartLegend scenarios={[baseScenario]} />
        </div>

        <div className="card todo">
          <div className="card-head">
            <DecisionDot size={10} />
            <h2 className="card-title">À traiter</h2>
          </div>
          <ul className="todo-list">
            <li><span><strong>{counts.toCategorize} opérations</strong> à catégoriser</span><Link to="/a-traiter">Traiter</Link></li>
            <li><span><strong>{counts.reconciliations} rapprochement{counts.reconciliations > 1 ? 's' : ''}</strong> suggéré{counts.reconciliations > 1 ? 's' : ''}</span><Link to="/a-traiter">Vérifier</Link></li>
            <li>
              <span><strong>{counts.overdue} facture{counts.overdue > 1 ? 's' : ''} client{counts.overdue > 1 ? 's' : ''}</strong> en retard · <span className="danger num">{formatEuroRounded(counts.overdueAmount)}</span></span>
              <Link to="/a-traiter">Relancer</Link>
            </li>
          </ul>
          <Link to="/a-traiter" className="cta-link">Tout traiter · {counts.total}</Link>
        </div>
      </section>

      <section className="home-row three">
        <div className="card stack">
          <h2 className="card-title">Prévu vs réalisé · {formatMonthName(current)}</h2>
          <div>
            <div className="row-between"><strong>Encaissements</strong><span className="num">{formatEuroRounded(tin.actual)} / {formatEuroRounded(tin.forecast)}</span></div>
            <Progress percent={pct(tin.actual, tin.forecast)} showInfo={false} strokeColor="var(--opt-in)" trailColor="var(--opt-mist)" />
            <div className="muted">Reste à encaisser : {formatEuroRounded(Math.max(0, tin.forecast - tin.actual))}</div>
          </div>
          <div>
            <div className="row-between"><strong>Décaissements</strong><span className="num">{formatEuroRounded(tout.actual)} / {formatEuroRounded(tout.forecast)}</span></div>
            <Progress percent={pct(tout.actual, tout.forecast)} showInfo={false} strokeColor="var(--opt-out-flow)" trailColor="var(--opt-mist)" />
            <div className="muted">Reste à décaisser : {formatEuroRounded(Math.max(0, tout.forecast - tout.actual))}</div>
          </div>
        </div>

        <div className="card stack">
          <h2 className="card-title">Prochaines échéances</h2>
          <ul className="due-list">
            {upcoming.map((c) => (
              <li key={c.id}>
                <span className="muted">{formatDate(c.dueAt, false)}</span>
                <span className="ellipsis">{c.counterparty}</span>
                <span className={`num ${c.flow === 'in' ? 'positive' : ''}`}>
                  {c.flow === 'in' ? '+' : '−'}{formatEuroRounded(c.amountInclTax)}
                </span>
              </li>
            ))}
            {upcoming.length === 0 && <li className="muted">Aucune échéance à venir.</li>}
          </ul>
        </div>

        <div className="card advice">
          <MotifStrip />
          <div className="stack advice-body">
            <h2 className="card-title">Conseils</h2>
            {tips.slice(0, 3).map((t) => (
              <p key={t.text} className="tip">
                {t.text} <Link to={t.link} className="strong-link">{t.label}</Link>
              </p>
            ))}
            {tips.length === 0 && <p className="tip">Tout est à jour. Votre trésorerie est fiable.</p>}
            <div className="advisor">
              <strong>Un expert Optimum à vos côtés</strong>
              <span>Construisez votre prévisionnel avec un conseiller et décidez en confiance.</span>
              <Button onClick={() => message.success('Demande envoyée. Un conseiller Optimum vous contacte sous 24 h ouvrées.')}>Être rappelé</Button>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
