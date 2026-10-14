import type { DateTime } from 'luxon';
import type { MembershipPhase } from './dates';
import { balanceStatus, type Balance, type BalanceStatus } from './payments';

/**
 * Entry decision for a scanned code. Runs on the server in Phase 4 (verifyAndCheckIn);
 * the order of checks below is the contract.
 */
export type DenyReason = 'CANCELLED' | 'CODE_USED' | 'BLOCKED' | 'SCHEDULED' | 'EXPIRED' | 'DUES_OVERDUE';
export type EntryNote = 'GRACE' | 'BALANCE_DUE' | null;

export interface EntryInput {
  now: DateTime;
  phase: MembershipPhase;
  cancelled: boolean;
  checkinBlocked: boolean;
  codeAlreadyUsed: boolean;
  balance: Balance | null;
}

export interface EntryDecision {
  allowed: boolean;
  reason: DenyReason | null;
  note: EntryNote; // shown to the receptionist when entry is allowed
  balanceStatus: BalanceStatus;
}

export function decideEntry(i: EntryInput): EntryDecision {
  const bs = balanceStatus(i.now, i.balance);
  const deny = (reason: DenyReason): EntryDecision => ({ allowed: false, reason, note: null, balanceStatus: bs });
  if (i.cancelled) return deny('CANCELLED');
  if (i.codeAlreadyUsed) return deny('CODE_USED');
  if (i.checkinBlocked) return deny('BLOCKED');
  if (i.phase === 'SCHEDULED') return deny('SCHEDULED');
  if (i.phase === 'EXPIRED') return deny('EXPIRED');
  if (bs === 'OVERDUE_BLOCKED') return deny('DUES_OVERDUE');
  return { allowed: true, reason: null, note: bs === 'OVERDUE_GRACE' ? 'GRACE' : bs === 'ON_TIME' ? 'BALANCE_DUE' : null, balanceStatus: bs };
}
