import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useGym } from '../app/GymContext';
import { useApp, type PreviewRole, type Theme } from '../app/AppContext';
import { GymLogoButton, UrcodLogo } from './Brand';
import { Icon, type IconName } from './Icon';
import { Notice, Toasts } from './ui';
import { demoMode } from '../firebase/client';
import { useSession } from '../app/SessionContext';
import type { StringKey } from '../i18n/strings';

declare const __APP_VERSION__: string;
export const APP_VERSION = __APP_VERSION__;

const ROLE_HOME: Record<PreviewRole, string> = {
  public: '/',
  member: '/member',
  cashier: '/cashier',
  coach: '/coach',
  admin: '/admin',
};

/** Preview-only role switcher. Removed in production builds once Firebase Auth exists (Phase 2). */
export function DemoBar() {
  const { t } = useApp();
  const { pathname } = useLocation();
  const roles: PreviewRole[] = ['public', 'member', 'cashier', 'coach', 'admin'];
  const current = roles.slice(1).find((r) => pathname.startsWith(ROLE_HOME[r])) ?? 'public';
  return (
    <div className="demo-bar" role="note">
      <span>
        <strong>{t('app.demoBanner')}</strong>
      </span>
      <nav className="roles" aria-label={t('app.previewAs')}>
        <span className="sr-only">{t('app.previewAs')}</span>
        {roles.map((r) => (
          <NavLink key={r} to={ROLE_HOME[r]} className={current === r ? 'active' : ''} end={r === 'public'}>
            {t(`role.${r}` as StringKey)}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

export function Prefs({ compact }: { compact?: boolean }) {
  const { t, lang, setLang, theme, setTheme } = useApp();
  return (
    <div className="row" style={{ gap: 4 }}>
      <button className={compact ? 'icon-btn' : 'btn btn-ghost btn-sm'} onClick={() => setLang(lang === 'ar' ? 'en' : 'ar')} aria-label={t('app.lang')}>
        <Icon name="globe" />
        {!compact && <span>{t('app.lang')}</span>}
      </button>
      <button className="icon-btn" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label={theme === 'dark' ? t('app.themeLight') : t('app.themeDark')}>
        <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
      </button>
    </div>
  );
}

/** Cloud status: admin and developer only; hidden from cashier (unless granted), coach and member. */
export function CloudStatus() {
  const { t } = useApp();
  return (
    <span className="cloud-pill" data-live={!demoMode || undefined} title={t(demoMode ? 'app.cloudDemo' : 'app.cloudLive')}>
      <Icon name={demoMode ? 'cloudOff' : 'cloud'} />
      <span className="desktop-only">{t(demoMode ? 'app.cloudDemo' : 'app.cloudLive')}</span>
    </span>
  );
}

export function Footer() {
  return (
    <footer className="footer">
      <UrcodLogo height={18} tappable />
      <span>Programmer &amp; Developer by Mahmoud Gamal Eldeen · Version {APP_VERSION}</span>
    </footer>
  );
}

export interface NavItem {
  to: string;
  label: string;
  icon: IconName;
  end?: boolean;
}

interface ShellProps {
  children: ReactNode;
  nav?: NavItem[];
  bottomNav?: NavItem[];
  defaultTheme: Theme;
  showCloud?: boolean;
  width?: 'narrow' | 'wide';
  title?: string;
  /**
   * Paths whose screens already use real data. On a connected deployment every other screen shows a
   * notice that it still runs on sample data until its phase arrives.
   */
  livePaths?: string[];
  /** Wording of that notice (members get a friendlier one). */
  sampleNote?: StringKey;
}

export function Shell({ children, nav, bottomNav, defaultTheme, showCloud, width = 'wide', title, livePaths = [], sampleNote = 'app.sampleScreen' }: ShellProps) {
  const { lang, t, applyRoleDefault } = useApp();
  const [drawer, setDrawer] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const { pathname } = useLocation();

  useEffect(() => applyRoleDefault(defaultTheme), [applyRoleDefault, defaultTheme]);
  useEffect(() => setDrawer(false), [pathname]);

  const gym = useGym();
  const name = lang === 'ar' ? gym.nameAr : gym.nameEn;
  const session = useSession();
  const navigate = useNavigate();
  // A path ending in $ matches exactly (an area's index page without its sub-pages).
  const sample = !demoMode && !livePaths.some((p) => (p.endsWith('$') ? pathname === p.slice(0, -1) : pathname === p || pathname.startsWith(p + '/')));

  const navList = nav && (
    <nav className="stack-sm" style={{ gap: 2 }} aria-label={title ?? name}>
      {nav.map((n) => (
        <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`} title={n.label}>
          <Icon name={n.icon} />
          <span className="nav-label">{n.label}</span>
        </NavLink>
      ))}
    </nav>
  );

  return (
    <div className={`layout ${bottomNav ? 'has-bottom-nav' : ''}`}>
      <header className="topbar">
        {nav && (
          <button className="icon-btn mobile-only" onClick={() => setDrawer(true)} aria-label="Menu">
            <Icon name="menu" />
          </button>
        )}
        {nav && (
          <button className="icon-btn desktop-only" onClick={() => setCollapsed((c) => !c)} aria-label="Toggle sidebar">
            <Icon name="sidebar" />
          </button>
        )}
        <div className="brand grow">
          <GymLogoButton tappable={false} />
          <span style={{ lineHeight: 1.25, minWidth: 0 }}>
            {name}
            {title && <span className="muted small" style={{ fontWeight: 600 }}> · {title}</span>}
          </span>
        </div>
        {showCloud && <CloudStatus />}
        <Prefs compact />
        {!demoMode && session.user && (
          <button className="icon-btn" onClick={() => session.signOut().then(() => navigate('/', { replace: true }))} aria-label={t('dev.signOut')} title={t('dev.signOut')}>
            <Icon name="logout" />
          </button>
        )}
      </header>

      <div className="layout-body">
        {nav && <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`}>{navList}</aside>}
        <main className={`main ${width}`} id="main">
          {sample && (
            <div style={{ marginBottom: 16 }}>
              <Notice icon="info">
                <span className="small">{t(sampleNote)}</span>
              </Notice>
            </div>
          )}
          {children}
        </main>
      </div>

      <Footer />

      {bottomNav && (
        <nav className="bottom-nav" aria-label={t('member.nav.home')}>
          {bottomNav.map((n, i) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => `${isActive ? 'active' : ''} ${i === 2 ? 'center' : ''}`}>
              {i === 2 ? (
                <span className="center-dot">
                  <Icon name={n.icon} />
                </span>
              ) : (
                <Icon name={n.icon} />
              )}
              <span>{n.label}</span>
            </NavLink>
          ))}
        </nav>
      )}

      {drawer && nav && (
        <>
          <div className="drawer-backdrop" onClick={() => setDrawer(false)} />
          <div className="drawer" role="dialog" aria-modal="true">
            <div className="row-between" style={{ marginBottom: 12 }}>
              <div className="row">
                <GymLogoButton tappable={false} />
                <strong>{name}</strong>
              </div>
              <button className="icon-btn" onClick={() => setDrawer(false)} aria-label={t('app.close')}>
                <Icon name="x" />
              </button>
            </div>
            {navList}
          </div>
        </>
      )}
      <Toasts />
    </div>
  );
}

/** Offline notice + "update available" prompt for the service worker. */
export function PwaStatus() {
  const { t } = useApp();
  const [online, setOnline] = useState(() => navigator.onLine);
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  useEffect(() => {
    if (!('serviceWorker' in navigator) || import.meta.env.DEV) return;
    let reloaded = false;
    navigator.serviceWorker
      .register('./sw.js')
      .then((reg) => {
        if (reg.waiting && navigator.serviceWorker.controller) setWaiting(reg.waiting);
        reg.addEventListener('updatefound', () => {
          const nw = reg.installing;
          nw?.addEventListener('statechange', () => {
            if (nw.state === 'installed' && navigator.serviceWorker.controller) setWaiting(nw);
          });
        });
      })
      .catch(() => {
        /* registration can fail inside sandboxed previews; the app works without it */
      });
    const onCtl = () => {
      if (!reloaded) {
        reloaded = true;
        window.location.reload();
      }
    };
    navigator.serviceWorker.addEventListener('controllerchange', onCtl);
    return () => navigator.serviceWorker.removeEventListener('controllerchange', onCtl);
  }, []);

  return (
    <>
      {!online && (
        <div className="notice notice-warning" style={{ borderRadius: 0 }} role="status">
          <Icon name="cloudOff" />
          <span>{t('app.offline')}</span>
        </div>
      )}
      {waiting && (
        <div className="notice notice-info" style={{ borderRadius: 0, alignItems: 'center' }} role="status">
          <Icon name="refresh" />
          <span className="grow">{t('app.updateReady')}</span>
          <button className="btn btn-primary btn-sm" onClick={() => waiting.postMessage('SKIP_WAITING')}>
            {t('app.updateNow')}
          </button>
        </div>
      )}
    </>
  );
}
