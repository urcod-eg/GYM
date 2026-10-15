import { describe, expect, it } from 'vitest';
import { checkEntry, checkIn, newCheckinCode, parseQr, qrText, type EntryMember } from './attendance';
import type { MembershipSummary } from './sales';

const D = 86_400_000;
const now = new Date('2026-10-15T10:00:00Z');
const ms = (over: Partial<MembershipSummary> = {}): MembershipSummary => ({
  id: 'ms', planNameAr: 'شهر', planNameEn: 'Month', unit: 'month', startsAt: new Date(now.getTime() - 5 * D), endsAt: new Date(now.getTime() + 20 * D),
  status: 'ACTIVE', visitQuota: null, visitsUsed: 0, prev: null, ...over,
});
const member = (over: Partial<EntryMember> = {}): EntryMember => ({ id: 'm1', membership: ms(), balance: null, blocks: {}, lastCheckInAt: null, ...over });

describe('QR text', () => {
  it('round-trips and rejects anything else', () => {
    const code = newCheckinCode();
    expect(parseQr(qrText('m1', code))).toEqual({ memberId: 'm1', code });
    expect(parseQr('https://evil.example')).toBeNull();
    expect(parseQr('GYMQR1:m1:abc')).toBeNull();
  });
});

describe('entry decision (mirrors the rules)', () => {
  it('lets a running member in', () => {
    expect(checkEntry(member(), now, null).allowed).toBe(true);
  });
  it('refuses: none, expired, not started, cancelled, blocked, too soon', () => {
    expect(checkEntry(member({ membership: null }), now, null).reason).toBe('NO_MEMBERSHIP');
    expect(checkEntry(member({ membership: ms({ endsAt: new Date(now.getTime() - 1) }) }), now, null).reason).toBe('EXPIRED');
    expect(checkEntry(member({ membership: ms({ startsAt: new Date(now.getTime() + D) }) }), now, null).reason).toBe('SCHEDULED');
    expect(checkEntry(member({ membership: ms({ status: 'CANCELLED' }) }), now, null).reason).toBe('CANCELLED');
    expect(checkEntry(member({ blocks: { CHECKIN_BLOCK: { until: null } } }), now, null).reason).toBe('BLOCKED');
    expect(checkEntry(member({ lastCheckInAt: new Date(now.getTime() - 60_000) }), now, null).reason).toBe('TOO_SOON');
  });
  it('a cancelled renewal still lets the running period in', () => {
    const prev = { planNameAr: 'أ', planNameEn: 'A', startsAt: new Date(now.getTime() - D), endsAt: new Date(now.getTime() + D) };
    expect(checkEntry(member({ membership: ms({ status: 'CANCELLED', startsAt: prev.endsAt, prev }) }), now, null).allowed).toBe(true);
  });
  it('late balance: refused unless an admin allowed entry; due soon: allowed with a note', () => {
    const late = { remaining: 100, total: 200, dueAt: new Date(now.getTime() - 1), membershipId: 'ms', graceUntil: null, graceReason: '' };
    expect(checkEntry(member({ balance: late }), now, null).reason).toBe('DUES_OVERDUE');
    expect(checkEntry(member({ balance: { ...late, graceUntil: new Date(now.getTime() + D) } }), now, null).note).toBe('GRACE');
    expect(checkEntry(member({ balance: { ...late, dueAt: new Date(now.getTime() + D) } }), now, null).note).toBe('BALANCE_DUE');
  });
  it('limited plans count visits and stop at the limit', () => {
    const r = checkEntry(member({ membership: ms({ visitQuota: 12, visitsUsed: 11 }) }), now, null);
    expect(r).toMatchObject({ allowed: true, counts: true, visitsLeft: 0 });
    expect(checkEntry(member({ membership: ms({ visitQuota: 12, visitsUsed: 12 }) }), now, null).reason).toBe('QUOTA_USED');
    const ops = checkIn({ actorUid: 'c', checkinId: 'ci', member: member({ membership: ms({ visitQuota: 12, visitsUsed: 3 }) }), method: 'MANUAL', code: null, counts: true });
    expect(ops[1].type === 'update' && ops[1].data['membership.visitsUsed']).toBe(4);
  });
  it('codes: wrong, used, older than 90 seconds', () => {
    const fresh = { code: 'ABCD2345', at: new Date(now.getTime() - 10_000), usedAt: null };
    expect(checkEntry(member(), now, { code: 'ABCD2345', doc: fresh }).allowed).toBe(true);
    expect(checkEntry(member(), now, { code: 'ZZZZ2345', doc: fresh }).reason).toBe('CODE_INVALID');
    expect(checkEntry(member(), now, { code: 'ABCD2345', doc: { ...fresh, usedAt: now } }).reason).toBe('CODE_USED');
    expect(checkEntry(member(), now, { code: 'ABCD2345', doc: { ...fresh, at: new Date(now.getTime() - 120_000) } }).reason).toBe('CODE_EXPIRED');
  });
});
