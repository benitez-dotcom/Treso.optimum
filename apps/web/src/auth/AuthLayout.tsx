import type { ReactNode } from 'react';
import { Logo } from '../layout/Brand';
import './auth.css';

const bars: [string, number, number][] = [
  ['#84ADB7', 180, 0], ['#303031', 120, 60], ['#E94F1C', 220, 10], ['#E5E4E4', 160, 90], ['#84ADB7', 260, 30],
  ['#114C5C', 140, 120], ['#E5E4E4', 200, 0], ['#303031', 170, 80], ['#84ADB7', 120, 40], ['#E94F1C', 90, 160],
  ['#E5E4E4', 240, 20], ['#303031', 150, 110], ['#84ADB7', 210, 50], ['#E5E4E4', 130, 140],
];

/** Mise en page des écrans hors application : motif Optimum à gauche, formulaire à droite. */
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="auth-shell">
      <aside className="auth-brand" aria-hidden="true">
        <div className="auth-motif">
          {bars.map(([color, h, top], i) => (
            <span key={i} style={{ background: color, height: h, marginTop: top }} />
          ))}
        </div>
        <div className="auth-brand-text">
          <Logo size={40} />
          <p>
            La solution est <span className="auth-accent">là.</span>
          </p>
        </div>
      </aside>
      <main className="auth-main">
        <div className="auth-card">{children}</div>
      </main>
    </div>
  );
}

export function FullPageSpinner({ label = 'Chargement…' }: { label?: string }) {
  return (
    <div className="full-spinner" role="status" aria-live="polite">
      <span className="spinner-dot" aria-hidden="true" />
      {label}
    </div>
  );
}
