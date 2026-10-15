import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { DateTime } from 'luxon';
import { GYM_TZ } from '../domain/dates';
import { STRINGS, type Lang, type StringKey } from '../i18n/strings';

export type Theme = 'light' | 'dark';
export type PreviewRole = 'public' | 'member' | 'cashier' | 'coach' | 'admin';

interface Toast {
  id: number;
  text: string;
  tone: 'info' | 'success' | 'danger';
}

interface AppState {
  lang: Lang;
  dir: 'rtl' | 'ltr';
  setLang: (l: Lang) => void;
  theme: Theme;
  setTheme: (t: Theme) => void;
  /** Role screens call this; it only applies when the viewer never chose a theme. */
  applyRoleDefault: (t: Theme) => void;
  t: (key: StringKey, vars?: Record<string, string | number>) => string;
  fmtDate: (dt: DateTime | Date | string | null | undefined, style?: 'short' | 'long') => string;
  fmtTime: (dt: DateTime | Date | string) => string;
  fmtNum: (n: number) => string;
  toast: (text: string, tone?: Toast['tone']) => void;
  toasts: Toast[];
  dismissToast: (id: number) => void;
}

const Ctx = createContext<AppState | null>(null);

// Light per-viewer conveniences only (allowed by the spec); everything must work without them.
function readPref<T extends string>(key: string, allowed: readonly T[]): T | null {
  try {
    const v = localStorage.getItem(key);
    return v && (allowed as readonly string[]).includes(v) ? (v as T) : null;
  } catch {
    return null;
  }
}
function writePref(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable — ignore */
  }
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => readPref('gym.lang', ['ar', 'en'] as const) ?? 'ar');
  const [themePref, setThemePref] = useState<Theme | null>(() => readPref('gym.theme', ['light', 'dark'] as const));
  const [roleDefault, setRoleDefault] = useState<Theme>('dark');
  const theme: Theme = themePref ?? roleDefault;
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const dir = lang === 'ar' ? 'rtl' : 'ltr';

  useEffect(() => {
    const html = document.documentElement;
    html.lang = lang;
    html.dir = dir;
    html.dataset.theme = theme;
    const meta = document.querySelector('meta[name="theme-color"]');
    meta?.setAttribute('content', theme === 'dark' ? '#101115' : '#F6F7F9');
  }, [lang, dir, theme]);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    writePref('gym.lang', l);
  }, []);
  const setTheme = useCallback((th: Theme) => {
    setThemePref(th);
    writePref('gym.theme', th);
  }, []);
  const applyRoleDefault = useCallback((th: Theme) => setRoleDefault(th), []);

  const t = useCallback(
    (key: StringKey, vars?: Record<string, string | number>) => {
      let s = STRINGS[lang][key] ?? key;
      if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
      return s;
    },
    [lang],
  );

  // Latin digits in both languages so dates, prices, phones and member codes read the same way.
  const locale = lang === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB';
  const toDT = (v: DateTime | Date | string) =>
    typeof v === 'string' ? DateTime.fromISO(v, { zone: GYM_TZ }) : v instanceof Date ? DateTime.fromJSDate(v, { zone: GYM_TZ }) : v.setZone(GYM_TZ);

  const fmtDate = useCallback(
    (v: DateTime | Date | string | null | undefined, style: 'short' | 'long' = 'long') =>
      v == null ? '—' : toDT(v).setLocale(locale).toLocaleString(style === 'long' ? { day: 'numeric', month: 'long', year: 'numeric' } : { day: 'numeric', month: 'short' }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [locale],
  );
  const fmtTime = useCallback(
    (v: DateTime | Date | string) => toDT(v).setLocale(locale).toLocaleString({ hour: 'numeric', minute: '2-digit' }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [locale],
  );
  const fmtNum = useCallback((n: number) => new Intl.NumberFormat(locale).format(n), [locale]);

  const dismissToast = useCallback((id: number) => setToasts((all) => all.filter((x) => x.id !== id)), []);
  const toast = useCallback(
    (text: string, tone: Toast['tone'] = 'info') => {
      const id = nextId.current++;
      setToasts((all) => [...all.slice(-2), { id, text, tone }]);
      setTimeout(() => dismissToast(id), 4500);
    },
    [dismissToast],
  );

  const value = useMemo<AppState>(
    () => ({ lang, dir, setLang, theme, setTheme, applyRoleDefault, t, fmtDate, fmtTime, fmtNum, toast, toasts, dismissToast }),
    [lang, dir, setLang, theme, setTheme, applyRoleDefault, t, fmtDate, fmtTime, fmtNum, toast, toasts, dismissToast],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp outside AppProvider');
  return v;
}

/** Shows the honest "needs server" notice instead of pretending an action happened. */
export function useServerAction() {
  const { t, toast } = useApp();
  return useCallback(() => toast(t('app.phaseLater'), 'info'), [t, toast]);
}
