/** Logo « optimum tréso » (reconstitution provisoire, à remplacer par le fichier du graphiste). */
export function Logo({ onDark = true, size = 28 }: { onDark?: boolean; size?: number }) {
  const ink = onDark ? '#FFFFFF' : 'var(--opt-petrol)';
  return (
    <div aria-label="optimum tréso" role="img" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <div
        aria-hidden="true"
        style={{ display: 'flex', alignItems: 'flex-end', fontFamily: 'var(--opt-font-title)', fontWeight: 600, fontSize: size, lineHeight: `${size}px`, letterSpacing: -0.5, color: ink }}
      >
        <span>opt</span>
        <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: size * 0.1, margin: '0 2px', transform: `translateY(${size * 0.32}px)` }}>
          <span style={{ width: size * 0.18, height: size * 0.6, background: '#E94F1C' }} />
          <span style={{ width: size * 0.25, height: size * 0.25, borderRadius: '50%', background: '#E94F1C' }} />
        </span>
        <span>mum</span>
      </div>
      <div aria-hidden="true" style={{ fontFamily: 'var(--opt-font-title)', fontSize: size * 0.64, color: '#84ADB7', paddingLeft: size * 1.85, marginTop: size * 0.15 }}>
        tréso
      </div>
    </div>
  );
}

const motifBars: [string, number][] = [
  ['#84ADB7', 30], ['#114C5C', 40], ['#E5E4E4', 22], ['#303031', 36], ['#E94F1C', 26], ['#84ADB7', 42],
  ['#114C5C', 18], ['#E5E4E4', 34], ['#303031', 28], ['#84ADB7', 40], ['#114C5C', 20], ['#E5E4E4', 32],
];

/** Bande décorative du motif de bâtonnets (surfaces « respirantes » uniquement). */
export function MotifStrip({ height = 44 }: { height?: number }) {
  return (
    <div aria-hidden="true" style={{ display: 'flex', gap: 6, padding: '0 16px', height, overflow: 'hidden', alignItems: 'flex-start' }}>
      {motifBars.map(([color, h], i) => (
        <span key={i} style={{ width: 10, height: (h / 44) * height, borderRadius: '0 0 6px 6px', background: color, flex: '0 0 auto' }} />
      ))}
    </div>
  );
}

/** Point de décision orange (repère « aujourd'hui », pastilles). */
export function DecisionDot({ size = 8 }: { size?: number }) {
  return <span aria-hidden="true" style={{ display: 'inline-block', width: size, height: size, borderRadius: '50%', background: 'var(--opt-orange)', flex: '0 0 auto' }} />;
}
