import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { DEFAULT_DEPOSIT_SETTINGS, type DepositSettings } from '../domain/payments';
import type { Piasters } from '../domain/plans';
import { DEMO_BALANCES, type DemoBalance } from '../mock/demo';

/**
 * Preview-only ledger state: outstanding balances, admin entry permissions, cancellations and the
 * deposit settings. In-memory, lost on reload. Phase 3 moves all of it to Firestore, written only by
 * server functions (payments, grants and refunds are audited, never edited from the browser).
 */
export interface Cancellation {
  memberId: string;
  refund: Piasters;
  overridden: boolean;
  reason: string;
  at: string;
}

interface LedgerState {
  settings: DepositSettings;
  setSettings: (s: DepositSettings) => void;
  balances: DemoBalance[];
  balanceOf: (memberId: string) => DemoBalance | null;
  grant: (memberId: string, until: string, reason: string) => void;
  revokeGrant: (memberId: string) => void;
  cancellations: Cancellation[];
  cancel: (c: Cancellation) => void;
  isCancelled: (memberId: string) => boolean;
}

const Ctx = createContext<LedgerState | null>(null);

export function LedgerProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<DepositSettings>(DEFAULT_DEPOSIT_SETTINGS);
  const [balances, setBalances] = useState<DemoBalance[]>(DEMO_BALANCES);
  const [cancellations, setCancellations] = useState<Cancellation[]>([]);

  const balanceOf = useCallback((id: string) => balances.find((b) => b.memberId === id && b.remaining > 0) ?? null, [balances]);

  const grant = useCallback(
    (memberId: string, until: string, reason: string) =>
      setBalances((all) => all.map((b) => (b.memberId === memberId ? { ...b, graceUntil: until, graceReason: reason } : b))),
    [],
  );
  const revokeGrant = useCallback(
    (memberId: string) => setBalances((all) => all.map((b) => (b.memberId === memberId ? { ...b, graceUntil: null, graceReason: null } : b))),
    [],
  );
  const cancel = useCallback((c: Cancellation) => {
    setCancellations((all) => [...all.filter((x) => x.memberId !== c.memberId), c]);
    // A cancelled member owes nothing: the outstanding balance is cleared.
    setBalances((all) => all.map((b) => (b.memberId === c.memberId ? { ...b, remaining: 0, graceUntil: null } : b)));
  }, []);
  const isCancelled = useCallback((id: string) => cancellations.some((c) => c.memberId === id), [cancellations]);

  const value = useMemo(
    () => ({ settings, setSettings, balances, balanceOf, grant, revokeGrant, cancellations, cancel, isCancelled }),
    [settings, balances, balanceOf, grant, revokeGrant, cancellations, cancel, isCancelled],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useLedger(): LedgerState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useLedger outside LedgerProvider');
  return v;
}
