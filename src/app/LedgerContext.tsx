import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { DateTime } from 'luxon';
import type { DepositSettings } from '../domain/payments';
import type { Piasters } from '../domain/plans';
import { DEFAULT_GYM_SETTINGS, gymDayEndingAt, type GymSettingsDoc, type PayMethod } from '../domain/sales';
import { demoMode } from '../firebase/client';
import * as data from '../firebase/data';
import { DEMO_BALANCES } from '../mock/demo';
import { demoRows, liveRow, type MemberRow } from '../pages/staff/shared';
import { useActor, useSession } from './SessionContext';

/**
 * Members, balances and gym settings for the staff screens.
 * Preview: sample data in memory (lost on reload). Live: Firestore, where every sale, payment,
 * entry permission and refund is checked and recomputed by the security rules and logged.
 */
export interface RowBalance {
  memberId: string;
  paid: Piasters;
  remaining: Piasters;
  dueDate: string; // gym day; late from the next day
  graceUntil: string | null; // last gym day an admin allows entry
  graceReason: string | null;
}

export interface Cancellation {
  memberId: string;
  refund: Piasters;
  overridden: boolean;
  reason: string;
  at: string;
}

export type SettingsView = DepositSettings & { cashierMaxDiscount: number; genderMode: GymSettingsDoc['genderMode']; ladiesHours: GymSettingsDoc['ladiesHours'] };

const toView = (s: GymSettingsDoc): SettingsView => ({
  enabled: s.depositEnabled,
  minPercent: s.depositMinPercent,
  graceDays: s.depositGraceDays,
  maxGraceDays: s.depositMaxGraceDays,
  cashierMaxDiscount: s.cashierMaxDiscount,
  genderMode: s.genderMode ?? 'MIXED',
  ladiesHours: s.ladiesHours ?? {},
});
export const toSettingsDoc = (v: SettingsView): GymSettingsDoc => ({
  depositEnabled: v.enabled,
  depositMinPercent: v.minPercent,
  depositGraceDays: v.graceDays,
  depositMaxGraceDays: v.maxGraceDays,
  cashierMaxDiscount: v.cashierMaxDiscount,
  genderMode: v.genderMode,
  ladiesHours: v.ladiesHours,
});

interface LedgerState {
  live: boolean;
  rows: MemberRow[] | null;
  rowsError: boolean;
  rowOf: (memberId: string) => MemberRow | null;
  settings: SettingsView;
  settingsDoc: GymSettingsDoc;
  /** Live: false until an admin saves the settings once (defaults apply meanwhile). */
  settingsSaved: boolean;
  saveSettings: (s: SettingsView) => Promise<void>;
  balances: RowBalance[];
  balanceOf: (memberId: string) => RowBalance | null;
  grant: (memberId: string, until: string, reason: string) => Promise<void>;
  revokeGrant: (memberId: string) => Promise<void>;
  payRemainder: (memberId: string, amount: Piasters, method: PayMethod, reference: string | null) => Promise<string>;
  cancellations: Cancellation[];
  cancel: (c: Cancellation) => void;
  isCancelled: (memberId: string) => boolean;
}

const Ctx = createContext<LedgerState | null>(null);

const STAFF_READERS = ['admin', 'accountant', 'cashier', 'developer'];

export function LedgerProvider({ children }: { children: ReactNode }) {
  const session = useSession();
  const actor = useActor();
  // ---- preview state
  const [demoSettings, setDemoSettings] = useState<GymSettingsDoc>(DEFAULT_GYM_SETTINGS);
  const [demoBalances, setDemoBalances] = useState<RowBalance[]>(DEMO_BALANCES.map((b) => ({ ...b, graceReason: b.graceReason })));
  const [cancellations, setCancellations] = useState<Cancellation[]>([]);
  // ---- live state
  const [docs, setDocs] = useState<data.MemberDoc[] | null>(null);
  const [rowsError, setRowsError] = useState(false);
  const [liveSettings, setLiveSettings] = useState<GymSettingsDoc | null | undefined>(undefined);
  const canRead = !demoMode && session.staffReady && session.roles.some((r) => STAFF_READERS.includes(r));

  useEffect(() => {
    if (!canRead) {
      setDocs(null);
      setLiveSettings(undefined);
      return;
    }
    let stopM: (() => void) | undefined;
    let stopS: (() => void) | undefined;
    let cancelled = false;
    setRowsError(false);
    data.watchMembers(setDocs, () => setRowsError(true)).then((u) => (cancelled ? u() : (stopM = u)));
    data.watchSettings(setLiveSettings, () => setLiveSettings(null)).then((u) => (cancelled ? u() : (stopS = u)));
    return () => {
      cancelled = true;
      stopM?.();
      stopS?.();
    };
  }, [canRead, session.user?.uid]);

  const settingsDoc = demoMode ? demoSettings : liveSettings ?? DEFAULT_GYM_SETTINGS;
  const settings = useMemo(() => toView(settingsDoc), [settingsDoc]);

  const rows = useMemo<MemberRow[] | null>(() => {
    if (demoMode) {
      const cancelledIds = new Set(cancellations.map((c) => c.memberId));
      return demoRows().map((r) => (cancelledIds.has(r.m.id) ? { ...r, cancelled: true } : r));
    }
    if (!docs) return null;
    const now = new Date();
    return docs.map((d) => liveRow(d, now));
  }, [docs, cancellations]);

  const byId = useMemo(() => new Map((rows ?? []).map((r) => [r.m.id, r])), [rows]);
  const rowOf = useCallback((id: string) => byId.get(id) ?? null, [byId]);

  const balances = useMemo<RowBalance[]>(() => {
    if (demoMode) return demoBalances.filter((b) => b.remaining > 0);
    return (docs ?? [])
      .filter((d) => d.balance && d.balance.remaining > 0)
      .map((d) => {
        const b = d.balance!;
        return {
          memberId: d.id,
          paid: Math.max(0, (b.total ?? b.remaining) - b.remaining),
          remaining: b.remaining,
          dueDate: gymDayEndingAt(b.dueAt),
          graceUntil: b.graceUntil ? gymDayEndingAt(b.graceUntil) : null,
          graceReason: b.graceReason || null,
        };
      });
  }, [docs, demoBalances]);

  const balanceOf = useCallback((id: string) => balances.find((b) => b.memberId === id) ?? null, [balances]);

  const docOf = useCallback(
    (id: string) => {
      const d = (docs ?? []).find((x) => x.id === id);
      if (!d) throw new data.AppFailure('not-found');
      return d;
    },
    [docs],
  );

  const saveSettings = useCallback(
    async (v: SettingsView) => {
      if (demoMode) return setDemoSettings(toSettingsDoc(v));
      await data.saveSettings(actor, toSettingsDoc(v));
    },
    [actor],
  );

  const grant = useCallback(
    async (memberId: string, until: string, reason: string) => {
      if (demoMode) {
        setDemoBalances((all) => all.map((b) => (b.memberId === memberId ? { ...b, graceUntil: until, graceReason: reason } : b)));
        return;
      }
      await data.setEntryPermission(actor, docOf(memberId), until, reason);
    },
    [actor, docOf],
  );

  const revokeGrant = useCallback(
    async (memberId: string) => {
      if (demoMode) {
        setDemoBalances((all) => all.map((b) => (b.memberId === memberId ? { ...b, graceUntil: null, graceReason: null } : b)));
        return;
      }
      await data.setEntryPermission(actor, docOf(memberId), null, '');
    },
    [actor, docOf],
  );

  const payRemainder = useCallback(
    async (memberId: string, amount: Piasters, method: PayMethod, reference: string | null) => {
      if (demoMode) {
        setDemoBalances((all) => all.map((b) => (b.memberId === memberId ? { ...b, remaining: Math.max(0, b.remaining - amount), paid: b.paid + amount } : b)));
        return 'R-' + DateTime.now().toFormat('yyMMdd') + '-DEMO0';
      }
      return data.payRemainder(actor, docOf(memberId), amount, method, reference);
    },
    [actor, docOf],
  );

  // Preview only: live cancellations go through data.cancelWithRefund (they need the membership record).
  const cancel = useCallback((c: Cancellation) => {
    setCancellations((all) => [...all.filter((x) => x.memberId !== c.memberId), c]);
    setDemoBalances((all) => all.map((b) => (b.memberId === c.memberId ? { ...b, remaining: 0, graceUntil: null } : b)));
  }, []);
  const isCancelled = useCallback((id: string) => (demoMode ? cancellations.some((c) => c.memberId === id) : !!byId.get(id)?.cancelled), [cancellations, byId]);

  const value = useMemo(
    () => ({
      live: !demoMode,
      rows,
      rowsError,
      rowOf,
      settings,
      settingsDoc,
      settingsSaved: demoMode || !!liveSettings,
      saveSettings,
      balances,
      balanceOf,
      grant,
      revokeGrant,
      payRemainder,
      cancellations,
      cancel,
      isCancelled,
    }),
    [rows, rowsError, rowOf, settings, settingsDoc, liveSettings, saveSettings, balances, balanceOf, grant, revokeGrant, payRemainder, cancellations, cancel, isCancelled],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useLedger(): LedgerState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useLedger outside LedgerProvider');
  return v;
}

/** Member rows for the staff screens (sample data in the preview). */
export function useRows(): MemberRow[] {
  return useLedger().rows ?? [];
}
