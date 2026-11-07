import logoPetrol from '../assets/brand/optimum-logo.svg';
import logoBlanc from '../assets/brand/optimum-logo-blanc.svg';

/**
 * Logo « optimum tréso » d'après la charte graphique Optimum : logotype officiel
 * (vectorisé depuis la charte) + déclinaison « tréso » en vert clair #84ADB7, alignée
 * comme les déclinaisons « gestion », « formation », « audit » (sous « mum », après le point).
 * `size` = hauteur des minuscules en px.
 */
export function Logo({ onDark = true, size = 18 }: { onDark?: boolean; size?: number }) {
  // Le fichier fait 2280×539 ; la hauteur d'x vaut ~0,46 de la hauteur totale.
  const height = size / 0.46;
  const width = (height * 2280) / 539;
  return (
    <div role="img" aria-label="optimum tréso" style={{ display: 'inline-flex', flexDirection: 'column', width }}>
      <img src={onDark ? logoBlanc : logoPetrol} alt="" aria-hidden="true" width={width} height={height} style={{ display: 'block' }} />
      <span
        aria-hidden="true"
        style={{
          alignSelf: 'flex-start',
          marginLeft: width * 0.445,
          marginTop: -height * 0.17,
          fontFamily: 'var(--opt-font-title)',
          fontWeight: 400,
          fontSize: size * 0.95,
          lineHeight: 1,
          color: '#84ADB7',
        }}
      >
        tréso
      </span>
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
