import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../app/AppContext';
import { GYM_LOGO_GATE, TapGate, URCOD_LOGO_GATE } from '../domain/tapGate';
import { useGym } from '../app/GymContext';

/** The gym's logo when the developer uploaded one, otherwise the default mark. */
export function GymMark() {
  const gym = useGym();
  if (gym.logoDataUrl) return <img src={gym.logoDataUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} draggable={false} />;
  return <DefaultMark />;
}

/** Default gym mark (original). Replaceable by the developer per gym; never copies a reference brand. */
function DefaultMark() {
  return (
    <svg viewBox="0 0 120 120" aria-hidden="true">
      <polygon points="60,10 103.3,35 103.3,85 60,110 16.7,85 16.7,35" fill="none" stroke="var(--brand-primary)" strokeWidth="8" strokeLinejoin="round" />
      <polyline points="26,60 49,60 54,40 63,79 69,54 72,60 94,60" fill="none" stroke="currentColor" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * Gym logo with the hidden staff entrances: 3 taps → cashier sign-in, 5 taps → admin sign-in.
 * Visual shortcut only; access is enforced by sign-in and the security rules. No hint of the tap count is shown.
 */
export function GymLogoButton({ size = 'md', tappable = true }: { size?: 'md' | 'lg'; tappable?: boolean }) {
  const navigate = useNavigate();
  const { lang } = useApp();
  const gym = useGym();
  const gate = useRef<TapGate<'cashier' | 'admin'> | null>(null);

  useEffect(() => {
    gate.current = new TapGate(GYM_LOGO_GATE, (role) => navigate(`/staff-login?role=${role}`));
    return () => gate.current?.reset();
  }, [navigate]);

  const name = lang === 'ar' ? gym.nameAr : gym.nameEn;
  if (!tappable) {
    return (
      <span className={`gym-logo ${size === 'lg' ? 'lg' : ''}`} role="img" aria-label={name}>
        <GymMark />
      </span>
    );
  }
  return (
    <button type="button" className={`gym-logo ${size === 'lg' ? 'lg' : ''}`} aria-label={name} onClick={() => gate.current?.tap()}>
      <GymMark />
    </button>
  );
}

/** urcod copyright mark. 10 taps open the separate developer gate (no hint shown). */
export function UrcodLogo({ height = 18, tappable = false }: { height?: number; tappable?: boolean }) {
  const { theme } = useApp();
  const navigate = useNavigate();
  const gate = useRef<TapGate<'developer'> | null>(null);

  useEffect(() => {
    if (!tappable) return;
    gate.current = new TapGate(URCOD_LOGO_GATE, () => navigate('/dev-login'));
    return () => gate.current?.reset();
  }, [navigate, tappable]);

  const src = theme === 'dark' ? './brand/urcod-on-dark.png' : './brand/urcod-on-light.png';
  const img = <img src={src} alt="urcod" style={{ height, width: 'auto' }} draggable={false} />;
  if (!tappable) return img;
  return (
    <button type="button" onClick={() => gate.current?.tap()} style={{ background: 'none', border: 0, padding: 4, cursor: 'default', minHeight: 44 }} aria-label="urcod">
      {img}
    </button>
  );
}
