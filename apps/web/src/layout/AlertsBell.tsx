/** Cloche des alertes de trésorerie (5.13) : seuil bas, retards, budgets dépassés, synchronisation. */
import { useEffect, useMemo, useState } from 'react';
import { Badge, Popover } from 'antd';
import { BellOutlined, CheckOutlined, WarningFilled } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useAlerts } from '../store/projection';
import { useStore } from '../store/useStore';

const key = (companyId: string | undefined) => `treso-alerts-read:${companyId ?? '-'}`;

function readIds(companyId: string | undefined): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(key(companyId)) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}

export function AlertsBell() {
  const alerts = useAlerts();
  const companyId = useStore((s) => s.company?.id);
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [read, setRead] = useState<Set<string>>(() => readIds(companyId));
  useEffect(() => setRead(readIds(companyId)), [companyId]);

  const unread = useMemo(() => alerts.filter((a) => !read.has(a.id)), [alerts, read]);

  const markRead = (ids: string[]) => {
    // On ne garde que les alertes encore actives : la liste reste courte
    const next = new Set([...ids, ...[...read].filter((id) => alerts.some((a) => a.id === id))]);
    setRead(next);
    try {
      localStorage.setItem(key(companyId), JSON.stringify([...next]));
    } catch {
      /* stockage indisponible */
    }
  };

  const content = (
    <div className="alerts-panel">
      <div className="alerts-head">
        <strong>Alertes</strong>
        {unread.length > 0 && (
          <button type="button" className="link-btn" onClick={() => markRead(alerts.map((a) => a.id))}>
            <CheckOutlined /> Tout marquer comme lu
          </button>
        )}
      </div>
      {alerts.length === 0 ? (
        <p className="muted alerts-empty">Aucune alerte : votre trésorerie est sous contrôle.</p>
      ) : (
        <ul className="alerts-list">
          {alerts.map((a) => (
            <li key={a.id} className={read.has(a.id) ? 'is-read' : undefined}>
              <button
                type="button"
                onClick={() => {
                  markRead([a.id]);
                  setOpen(false);
                  navigate(a.link);
                }}
              >
                <WarningFilled className={`alert-icon ${a.severity}`} aria-hidden="true" />
                <span>
                  <strong>{a.title}</strong>
                  <span className="muted">{a.message}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  return (
    <Popover content={content} trigger="click" open={open} onOpenChange={setOpen} placement="bottomRight" arrow={false}>
      <button type="button" className="icon-btn" aria-label={unread.length ? `Alertes : ${unread.length} non lue${unread.length > 1 ? 's' : ''}` : 'Alertes'}>
        <Badge count={unread.length} size="small" offset={[4, -4]} color="var(--opt-orange)">
          <BellOutlined />
        </Badge>
      </button>
    </Popover>
  );
}
