import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { DEFAULT_PLANS, type Plan } from '../domain/plans';
import { planDocFromPlan, planFromDoc } from '../domain/sales';
import { demoMode } from '../firebase/client';
import * as data from '../firebase/data';
import { useActor, useSession } from './SessionContext';

/**
 * Plan catalogue. Preview: in memory. Live: Firestore `plans`, written only by an admin (the rules
 * check the shape and log every change). A plan that was sold is never erased: it is paused, and
 * every sale keeps its own copy of the price.
 */
interface PlansState {
  plans: Plan[];
  activePlans: Plan[];
  /** Live and the catalogue is still empty (the admin can add the default plans in one step). */
  empty: boolean;
  loading: boolean;
  upsert: (p: Plan) => Promise<void>;
  remove: (id: string) => Promise<void>;
  seedDefaults: () => Promise<void>;
}

const Ctx = createContext<PlansState | null>(null);

export function PlansProvider({ children }: { children: ReactNode }) {
  const session = useSession();
  const actor = useActor();
  const [demoPlans, setDemoPlans] = useState<Plan[]>(DEFAULT_PLANS);
  const [live, setLive] = useState<(Plan & { sort: number })[] | null>(null);
  const signedIn = !demoMode && !!session.user && !!session.profile && session.profile.status === 'active';

  useEffect(() => {
    if (!signedIn) {
      setLive(null);
      return;
    }
    let stop: (() => void) | undefined;
    let cancelled = false;
    data
      .watchPlans(
        (rows) => setLive(rows.map(({ id, ...d }) => planFromDoc(id, d))),
        () => setLive([]),
      )
      .then((u) => (cancelled ? u() : (stop = u)));
    return () => {
      cancelled = true;
      stop?.();
    };
    // Re-subscribe when the staff second step completes (reads need it).
  }, [signedIn, session.staffReady, session.user?.uid]);

  const plans = demoMode ? demoPlans : live ?? [];

  const upsert = useCallback(
    async (p: Plan) => {
      if (demoMode) {
        setDemoPlans((all) => (all.some((x) => x.id === p.id) ? all.map((x) => (x.id === p.id ? p : x)) : [...all, p]));
        return;
      }
      const existing = (live ?? []).find((x) => x.id === p.id);
      const sort = existing?.sort ?? (live ?? []).reduce((m, x) => Math.max(m, x.sort + 1), 0);
      await data.savePlan(actor, p.id, planDocFromPlan(p, Math.min(1000, sort)));
    },
    [live, actor],
  );

  const remove = useCallback(
    async (id: string) => {
      if (demoMode) {
        setDemoPlans((all) => all.filter((x) => x.id !== id));
        return;
      }
      // Live plans are paused, never erased (old sales point at them).
      const p = (live ?? []).find((x) => x.id === id);
      if (p) await data.savePlan(actor, id, planDocFromPlan({ ...p, active: false }, p.sort));
    },
    [live, actor],
  );

  const seedDefaults = useCallback(async () => {
    if (demoMode) return;
    let sort = 0;
    for (const p of DEFAULT_PLANS) {
      // The custom plan has no price; the others start with the sample prices, editable after.
      await data.savePlan(actor, p.id, planDocFromPlan(p, sort++));
    }
  }, [actor]);

  const value = useMemo(
    () => ({ plans, activePlans: plans.filter((p) => p.active), empty: !demoMode && live !== null && live.length === 0, loading: !demoMode && signedIn && live === null, upsert, remove, seedDefaults }),
    [plans, live, signedIn, upsert, remove, seedDefaults],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePlans(): PlansState {
  const v = useContext(Ctx);
  if (!v) throw new Error('usePlans outside PlansProvider');
  return v;
}
