import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { User } from 'firebase/auth';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useApp } from './AppContext';
import { demoMode, firebase } from '../firebase/client';
import { watchOwnMember, watchProfile, type MemberDoc, type UserProfile } from '../firebase/data';
import { activeBlocks } from '../domain/writes';

/**
 * The signed-in person and their profile (users/{uid}). The UI uses this only to choose screens;
 * every read and write is checked again by the security rules, which read the same profile.
 */
export interface Session {
  loading: boolean;
  user: User | null;
  profile: UserProfile | null;
  /** Roles only while the profile is active; empty for disabled or replaced accounts. */
  roles: string[];
  memberId: string | null;
  member: MemberDoc | null;
  /** Block scopes in force on the member's file (or LOGIN_BLOCK when the rules refuse to show it). */
  blocks: string[];
  /** This sign-in used a second factor (needed for developer writes). */
  mfa: boolean;
  signOut: () => Promise<void>;
}

const Ctx = createContext<Session | null>(null);

type State = Omit<Session, 'signOut'>;
const EMPTY: State = { loading: false, user: null, profile: null, roles: [], memberId: null, member: null, blocks: [], mfa: false };

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>({ ...EMPTY, loading: !demoMode });

  useEffect(() => {
    if (demoMode) return;
    let stopAuth: (() => void) | undefined;
    let stopProfile: (() => void) | undefined;
    let stopMember: (() => void) | undefined;
    let cancelled = false;
    const clear = () => {
      stopProfile?.();
      stopMember?.();
      stopProfile = stopMember = undefined;
    };
    Promise.all([firebase(), import('firebase/auth')]).then(([{ auth }, A]) => {
      if (cancelled) return;
      stopAuth = A.onAuthStateChanged(auth, async (user) => {
        clear();
        if (!user) return setState(EMPTY);
        setState((s) => ({ ...s, loading: true, user }));
        // True only when this sign-in itself used the second factor (what the rules check).
        const mfa = !!(await user.getIdTokenResult()).signInSecondFactor;
        const unsub = await watchProfile(user.uid, (profile) => {
          stopMember?.();
          stopMember = undefined;
          const ok = profile?.status === 'active';
          const roles = ok ? profile!.roles : [];
          const memberId = ok && profile!.kind === 'member' ? profile!.memberId : null;
          setState({ loading: !!memberId, user, profile, roles, memberId, member: null, blocks: [], mfa });
          if (memberId) {
            watchOwnMember(memberId, (member, blocked) => {
              setState((s) => ({ ...s, loading: false, member, blocks: blocked ? ['LOGIN_BLOCK'] : activeBlocks(member?.blocks, new Date()) }));
            }).then((u) => (stopMember = u));
          }
        });
        if (cancelled) unsub();
        else stopProfile = unsub;
      });
    });
    return () => {
      cancelled = true;
      clear();
      stopAuth?.();
    };
  }, []);

  const value = useMemo<Session>(
    () => ({
      ...state,
      signOut: async () => {
        if (demoMode) return;
        const [{ auth }, { signOut }] = await Promise.all([firebase(), import('firebase/auth')]);
        await signOut(auth);
      },
    }),
    [state],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): Session {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSession outside SessionProvider');
  return v;
}

/** The signed-in staff member as an actor for writes (uid + roles). */
export function useActor() {
  const s = useSession();
  return useMemo(() => ({ uid: s.user?.uid ?? 'demo', roles: demoMode ? ['admin', 'cashier', 'developer'] : s.roles }), [s.user, s.roles]);
}

/** Where each role lands after signing in. */
export function homeFor(roles: string[]): string {
  if (roles.includes('developer')) return '/dev';
  if (roles.includes('admin')) return '/admin';
  if (roles.includes('accountant')) return '/admin';
  if (roles.includes('cashier')) return '/cashier';
  if (roles.includes('coach')) return '/coach';
  if (roles.includes('member')) return '/member';
  return '/';
}

/** Route guard. In demo mode every screen is open (the preview role switcher handles navigation). */
export function RequireRole({ any, children }: { any: string[]; children: ReactNode }) {
  const s = useSession();
  const loc = useLocation();
  if (demoMode) return <>{children}</>;
  if (s.loading) return <div className="main" aria-busy="true" />;
  if (!s.user) return <Navigate to="/" replace state={{ from: loc.pathname }} />;
  if (!s.roles.some((r) => any.includes(r))) return <Navigate to={s.roles.length ? homeFor(s.roles) : '/'} replace />;
  if (s.roles.includes('member') && any.includes('member') && s.blocks.some((b) => b === 'LOGIN_BLOCK' || b === 'TEMPORARY_SUSPENSION')) return <BlockedScreen />;
  return <>{children}</>;
}

/** A member whose file carries a sign-in block or an active suspension. The rules hide their data anyway. */
function BlockedScreen() {
  const { t } = useApp();
  const s = useSession();
  const navigate = useNavigate();
  return (
    <main className="main narrow" style={{ minHeight: '70dvh', display: 'grid', placeItems: 'center' }}>
      <div className="card stack" style={{ maxWidth: 420, textAlign: 'center' }}>
        <strong style={{ fontSize: '1.125rem' }}>{t('err.account-blocked')}</strong>
        <button className="btn btn-secondary" onClick={() => s.signOut().then(() => navigate('/', { replace: true }))}>
          {t('dev.signOut')}
        </button>
      </div>
    </main>
  );
}
