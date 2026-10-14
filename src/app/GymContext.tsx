import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { demoMode } from '../firebase/client';
import { watchGymConfig, type GymConfig } from '../firebase/data';
import { DEMO_GYM } from '../mock/demo';

/** The gym's public identity: name, logo, colour and support phone, as set by the developer. */
export interface Gym extends GymConfig {
  taglineAr: string;
  taglineEn: string;
  /** False until the developer saves the identity for the first time. */
  configured: boolean;
}

const FALLBACK: Gym = {
  nameAr: 'الجيم',
  nameEn: 'GYM',
  codePrefix: 'GYM',
  primaryColor: '#E51C35',
  supportPhone: '',
  logoDataUrl: null,
  taglineAr: DEMO_GYM.taglineAr,
  taglineEn: DEMO_GYM.taglineEn,
  configured: false,
};

const DEMO: Gym = { ...FALLBACK, nameAr: DEMO_GYM.nameAr, nameEn: DEMO_GYM.nameEn, codePrefix: 'PLS', supportPhone: DEMO_GYM.supportPhone, configured: true };

const Ctx = createContext<Gym>(DEMO);

export function GymProvider({ children }: { children: ReactNode }) {
  const [gym, setGym] = useState<Gym>(demoMode ? DEMO : FALLBACK);
  useEffect(() => {
    if (demoMode) return;
    let stop: (() => void) | undefined;
    let cancelled = false;
    watchGymConfig((c) => setGym(c ? { ...FALLBACK, ...c, configured: true } : FALLBACK)).then((u) => {
      if (cancelled) u();
      else stop = u;
    });
    return () => {
      cancelled = true;
      stop?.();
    };
  }, []);
  useEffect(() => {
    document.documentElement.style.setProperty('--brand-primary', gym.primaryColor);
  }, [gym.primaryColor]);
  return <Ctx.Provider value={gym}>{children}</Ctx.Provider>;
}

export const useGym = () => useContext(Ctx);
