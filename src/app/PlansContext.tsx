import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { DEFAULT_PLANS, type Plan } from '../domain/plans';

/**
 * Plan catalogue for the preview. Phase 1 keeps it in memory (lost on reload).
 * Phase 3 replaces this with Firestore + server functions: price changes never touch existing
 * orders (each order keeps a pricing snapshot), and a plan already sold is archived, not erased.
 */
interface PlansState {
  plans: Plan[];
  activePlans: Plan[];
  upsert: (p: Plan) => void;
  remove: (id: string) => void;
}

const Ctx = createContext<PlansState | null>(null);

export function PlansProvider({ children }: { children: ReactNode }) {
  const [plans, setPlans] = useState<Plan[]>(DEFAULT_PLANS);

  const upsert = useCallback((p: Plan) => {
    setPlans((all) => (all.some((x) => x.id === p.id) ? all.map((x) => (x.id === p.id ? p : x)) : [...all, p]));
  }, []);

  const remove = useCallback((id: string) => setPlans((all) => all.filter((x) => x.id !== id)), []);

  const value = useMemo(() => ({ plans, activePlans: plans.filter((p) => p.active), upsert, remove }), [plans, upsert, remove]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePlans(): PlansState {
  const v = useContext(Ctx);
  if (!v) throw new Error('usePlans outside PlansProvider');
  return v;
}
