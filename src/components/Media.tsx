/**
 * Athlete photography (cut-outs, transparent background) used across the app.
 * Files live in public/media and are cached by the service worker as public assets.
 * To change a picture for one gym, replace the .webp with the same name (transparent PNG/WebP cut-out).
 */
export type Figure = 'curl' | 'abs' | 'ropes' | 'squat' | 'flex' | 'gear';

export const mediaUrl = (f: Figure) => `./media/${f}.webp`;

/**
 * The login hero: a dark band with red stripes drifting behind the athlete,
 * who rises out of the band and "powers up" from black-and-white to colour.
 */
export function HeroStage({ figure }: { figure: Figure }) {
  return (
    <div className="hero-stage" aria-hidden="true">
      <div className="hero-band">
        <span className="hero-stripes" />
        <span className="hero-bar b1" />
        <span className="hero-bar b2" />
        <span className="hero-bar b3" />
        <span className="hero-sweep" />
      </div>
      <img className="hero-figure" src={mediaUrl(figure)} alt="" decoding="async" fetchPriority="high" key={figure} />
    </div>
  );
}

/** Square tile for offer / announcement cards: black-and-white athlete on a tinted stripe field; colour on hover. */
export function PhotoTile({ figure, tone = 'red', large }: { figure: Figure; tone?: 'red' | 'gold' | 'blue'; large?: boolean }) {
  return (
    <div className={`photo-tile tone-${tone} ${large ? 'large' : ''}`} aria-hidden="true">
      <span className="photo-stripes" />
      <img src={mediaUrl(figure)} alt="" loading="lazy" decoding="async" />
    </div>
  );
}

/** Variant number used by promo cards → which athlete and tint to show. */
export const PROMO_FIGURES: { figure: Figure; tone: 'red' | 'gold' | 'blue' }[] = [
  { figure: 'flex', tone: 'red' },
  { figure: 'curl', tone: 'red' },
  { figure: 'squat', tone: 'blue' },
  { figure: 'abs', tone: 'gold' },
];
