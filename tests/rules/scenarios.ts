/**
 * Security scenarios for firestore.rules, written once and run twice:
 *   - tests/rules-sim/rules.sim.test.ts  → the in-repo simulator (runs anywhere: `npm test`)
 *   - tests/rules/firestore.rules.test.ts → the official Firestore emulator (`npm run test:rules`, Java 21, CI)
 * Every allowed write here is produced by the same builders the app uses (src/domain/writes.ts).
 */
import { createHash } from 'node:crypto';
import { describe, expect, it, beforeEach } from 'vitest';
import {
  liftMemberBlock,
  memberInvite,
  redeemInvite,
  registerMember,
  SERVER_TIME,
  setBranding,
  setLicense,
  setMemberBlock,
  staffInvite,
  updateStaff,
  removeStaff,
  setStaffPin,
  setDevSecret,
  devSecretValue,
  pinAttempt,
  openStaffSession,
  endStaffSession,
  unlockPin,
  wipeRecord,
  wipeDeletes,
  setMemberGender,
  type InviteDoc,
  type WriteOp,
} from '../../src/domain/writes';
import {
  cancelMembership,
  DEFAULT_GYM_SETTINGS,
  grantEntry,
  newReceiptNo,
  payBalance,
  sellMembership,
  setGymSettings,
  setPlan,
  type BalanceDoc,
  type MembershipSummary,
  type PlanDoc,
  type SaleInput,
} from '../../src/domain/sales';
import { DateTime } from 'luxon';
import { setBanner, setVipTier, setMemberVip, type BannerDoc } from '../../src/domain/content';
import { archiveNotice, readNotice, sendNotice, type NoticeInput } from '../../src/domain/notices';
import { checkIn, writeToken, type EntryMember } from '../../src/domain/attendance';
import { addFinanceEntry, closeCash, voidFinanceEntry } from '../../src/domain/finance';
import { addWeight, assignCoach, setLibraryExercise, setNutritionPlan, setWorkoutDay, setWorkoutPlan, type WorkoutPlan } from '../../src/domain/coaching';

export interface AuthSpec {
  uid: string;
  email?: string;
  mfa?: boolean;
  /** The sign-in's auth_time (seconds). Defaults to SIGNED_IN_AT. */
  authTime?: number;
}
/** auth_time of every seeded staff session. */
export const SIGNED_IN_AT = 1_700_000_000;
/** Loosely typed so tests can hand-craft hostile writes. */
export type Op = { type: 'set' | 'update'; path: string; data: Record<string, unknown> } | { type: 'delete'; path: string };
type Data = Record<string, unknown>;

export interface Client {
  get(path: string): Promise<Data | null>;
  list(collection: string, field?: string, value?: unknown): Promise<unknown[]>;
  commit(ops: Op[]): Promise<void>;
}
export interface Harness {
  reset(): Promise<void>;
  seed(docs: Record<string, Data>): Promise<void>;
  peek(path: string): Promise<Data | undefined>;
  as(auth: AuthSpec | null): Client;
  isDenied(e: unknown): boolean;
}

const H = 3600_000;
const D = 24 * H;
const hex64 = (n: number) => n.toString(16).padStart(64, '0');
const email = (n: number) => `m-${n.toString(16).padStart(24, '0')}@login.urcod.invalid`;
const semail = (n: number) => `s-${n.toString(16).padStart(24, '0')}@login.urcod.invalid`;

const PHONE_MEM1 = '+201011111111';
const PHONE_MEM2 = '+201022222222';
const PHONE_MEM3 = '+201033333333';
const PHONE_CASH = '+201511111111';

function staffUser(roles: string[], phone: string, status = 'active') {
  return { kind: 'staff', roles, status, displayName: 'موظف', phone, memberId: null, inviteId: null, createdAt: new Date() };
}

const SALT = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
const CASH_PIN = '4826';
const sha = (x: string) => createHash('sha256').update(x, 'utf8').digest('hex');
const session = (now: number) => ({ authTime: SIGNED_IN_AT, device: 'test', at: new Date(now) });

function world(now: number): Record<string, Data> {
  return {
    'staffSessions/dev': session(now),
    'staffSessions/admin1': session(now),
    'staffSessions/admin2': session(now),
    'staffSessions/cash1': session(now),
    'staffSessions/cash-off': session(now),
    'staffSessions/coach1': session(now),
    'staffSessions/acc1': session(now),
    'pinSecrets/cash1': { salt: SALT, hash: sha(SALT + CASH_PIN), setBy: 'admin1', setAt: new Date(now), lastAuditId: 'seed-p' },
    'users/dev': { kind: 'developer', roles: ['developer'], status: 'active', displayName: 'Dev', phone: null, memberId: null, inviteId: null, createdAt: new Date(now) },
    'users/admin1': staffUser(['admin'], '+201500000001'),
    'users/admin2': staffUser(['admin'], '+201500000002'),
    'users/cash1': staffUser(['cashier'], PHONE_CASH),
    'users/cash-off': staffUser(['cashier'], '+201500000004', 'disabled'),
    'users/coach1': staffUser(['coach'], '+201500000005'),
    'users/acc1': staffUser(['accountant'], '+201500000006'),
    'loginAliases/s+201511111111': { email: semail(1), uid: 'cash1', inviteId: 'seed', at: new Date(now) },
    'license/main': { type: 'TRIAL', state: 'ACTIVE', startsAt: new Date(now - D), endsAt: new Date(now + 13 * D), version: 1, note: '', updatedAt: new Date(now), updatedBy: 'dev', lastAuditId: 'seed-l' },
    'gymPublicConfig/main': { nameAr: 'بلس جيم', nameEn: 'PULSE GYM', codePrefix: 'PLS', primaryColor: '#E51C35', supportPhone: '+201508613866', logoDataUrl: null, updatedAt: new Date(now), updatedBy: 'dev', lastAuditId: 'seed-b' },
    'counters/members': { next: 10004, lastMemberId: 'mem3', updatedAt: new Date(now) },
    'members/mem1': member('mem1', 10001, 'أحمد علي', PHONE_MEM1, 'u-mem1', 'coach1'),
    'phoneIndex/+201011111111': { memberId: 'mem1', createdAt: new Date(now) },
    'users/u-mem1': { kind: 'member', roles: ['member'], status: 'active', displayName: 'أحمد علي', phone: PHONE_MEM1, memberId: 'mem1', inviteId: 'seed', createdAt: new Date(now) },
    'loginAliases/m+201011111111': { email: email(1), uid: 'u-mem1', inviteId: 'seed', at: new Date(now) },
    'members/mem2': member('mem2', 10002, 'سارة محمود', PHONE_MEM2, null, null),
    'phoneIndex/+201022222222': { memberId: 'mem2', createdAt: new Date(now) },
    'members/mem3': { ...member('mem3', 10003, 'كريم', PHONE_MEM3, 'u-mem3', null), blocks: { LOGIN_BLOCK: { reasonCode: 'MISCONDUCT', note: '', until: null, by: 'admin1', at: new Date(now) } } },
    'users/u-mem3': { kind: 'member', roles: ['member'], status: 'active', displayName: 'كريم', phone: PHONE_MEM3, memberId: 'mem3', inviteId: 'seed', createdAt: new Date(now) },
    'auditLogs/seed-a': { actorUid: 'cash1', action: 'member.register', entityType: 'members', entityId: 'mem1', at: new Date(now), summary: {} },
    'plans/p_m1': { ...PLAN_M1, updatedAt: new Date(now), lastAuditId: 'seed-pl1' },
    'plans/p_day': { ...PLAN_DAY, updatedAt: new Date(now), lastAuditId: 'seed-pl2' },
    'plans/p_custom': { ...PLAN_CUSTOM, updatedAt: new Date(now), lastAuditId: 'seed-pl3' },
    'gymSettings/main': { ...DEFAULT_GYM_SETTINGS, updatedAt: new Date(now), lastAuditId: 'seed-gs' },
  };
}

const PLAN_M1: PlanDoc = { code: 'M1', nameAr: 'شهر', nameEn: '1 month', unit: 'month', value: 1, visitQuota: null, price: 100000, featured: false, active: true, sort: 1 };
const PLAN_DAY: PlanDoc = { code: 'DAY', nameAr: 'حصة يوم', nameEn: 'Day pass', unit: 'session', value: 1, visitQuota: 1, price: 10000, featured: false, active: true, sort: 0 };
const PLAN_CUSTOM: PlanDoc = { code: 'CUSTOM', nameAr: 'مدة مخصصة', nameEn: 'Custom', unit: 'custom', value: 1, visitQuota: null, price: 0, featured: false, active: true, sort: 9 };
const cairoToday = (plusDays = 0) => DateTime.now().setZone('Africa/Cairo').plus({ days: plusDays }).toISODate()!;

function member(id: string, no: number, name: string, phone: string, authUid: string | null, coach: string | null) {
  return {
    memberNo: no,
    memberCode: `PLS-${no}`,
    fullName: name,
    phoneE164: phone,
    authUid,
    accountStatus: authUid ? 'ACTIVE' : 'PENDING_ACTIVATION',
    assignedCoachId: coach,
    vipTierId: null,
    blocks: {},
    searchTokens: [],
    lastInviteId: null,
    createdAt: new Date(),
    createdBy: 'cash1',
    updatedAt: new Date(),
    lastAuditId: `seed-${id}`,
  };
}

export function defineScenarios(name: string, h: Harness) {
  const ok = (p: Promise<unknown>) => expect(p).resolves.not.toThrow();
  const denied = async (p: Promise<unknown>) => {
    let err: unknown = null;
    try {
      await p;
    } catch (e) {
      err = e;
    }
    expect(err, 'expected PERMISSION_DENIED').not.toBeNull();
    if (!h.isDenied(err)) throw err;
  };

  // DEV has an open session (code + phrase entered for this sign-in); DEV_NO_MFA is a fresh sign-in without it.
  const DEV = { uid: 'dev', email: 'dev@urcod.example' };
  const DEV_NO_MFA = { uid: 'dev', email: 'dev@urcod.example', authTime: SIGNED_IN_AT + 999 };
  const ADMIN = { uid: 'admin1', email: semail(11) };
  const CASHIER = { uid: 'cash1', email: semail(1) };
  const CASHIER_OFF = { uid: 'cash-off', email: semail(4) };
  const COACH = { uid: 'coach1', email: semail(5) };
  const ACCOUNTANT = { uid: 'acc1', email: semail(6) };
  const MEMBER1 = { uid: 'u-mem1', email: email(1) };
  const MEMBER3 = { uid: 'u-mem3', email: email(3) };
  let seq = 0;
  const nextId = (p: string) => `${p}${++seq}`;

  async function registerAs(auth: AuthSpec, fullName: string, phone: string, tweak?: (ops: WriteOp[]) => Op[]) {
    const c = h.as(auth);
    const cfg = await c.get('gymPublicConfig/main');
    const counter = (await c.get('counters/members')) as { next: number } | null;
    const r = registerMember({ actorUid: auth.uid, memberId: nextId('new-mem-'), auditId: nextId('aud-'), fullName, phone, codePrefix: (cfg?.codePrefix as string) ?? null, counter, phoneOwner: null });
    await c.commit(tweak ? tweak(r.ops) : r.ops);
    return r;
  }

  const inviteData = (path: string, data: Data | null | undefined) => {
    if (!data) throw new Error(`no invite at ${path}`);
    const exp = data.expiresAt as Date | { toDate(): Date };
    return { ...data, expiresAt: exp instanceof Date ? exp : exp.toDate() } as unknown as InviteDoc;
  };

  describe(`firestore.rules — ${name}`, () => {
    beforeEach(async () => {
      await h.reset();
      await h.seed(world(Date.now()));
    });

    describe('registering members', () => {
      it('a cashier registers a member: number, phone index and audit entry in one write', async () => {
        const r = await registerAs(CASHIER, 'منى حسن', '0101 444 5555');
        expect(r.memberCode).toBe('PLS-10004');
        expect((await h.peek('counters/members'))?.next).toBe(10005);
        expect((await h.peek(`phoneIndex/${r.phoneE164}`))?.memberId).toBeTruthy();
      });
      it('coaches, accountants, members, disabled staff and strangers cannot register', async () => {
        for (const who of [COACH, ACCOUNTANT, MEMBER1, CASHIER_OFF, { uid: 'stranger', email: email(99) }]) {
          await denied(registerAs(who, 'منى حسن', '01014445555'));
        }
      });
      it('a phone number can belong to one member only', async () => {
        await denied(registerAs(CASHIER, 'نسخة', '01011111111'));
      });
      it('member numbers cannot be skipped or reused', async () => {
        const bump = (n: number) => (ops: WriteOp[]) =>
          ops.map((o) => (o.path === 'counters/members' ? { ...o, data: { ...o.data, next: n + 1 } } : o.path.startsWith('members/') ? { ...o, data: { ...o.data, memberNo: n, memberCode: `PLS-${n}` } } : o));
        await denied(registerAs(CASHIER, 'منى حسن', '01014445555', bump(10010)));
        await denied(registerAs(CASHIER, 'منى حسن', '01014445555', bump(10001)));
      });
      it('every registration needs its audit entry', async () => {
        await denied(registerAs(CASHIER, 'منى حسن', '01014445555', (ops) => ops.filter((o) => !o.path.startsWith('auditLogs/'))));
      });
      it('a new member may be registered as men or ladies, nothing else', async () => {
        const g = (v: unknown) => (ops: WriteOp[]) => ops.map((o) => (o.path.startsWith('members/') ? { ...o, data: { ...o.data, gender: v } } : o));
        await denied(registerAs(CASHIER, 'منى حسن', '01014445555', g('X')));
        await ok(registerAs(CASHIER, 'منى حسن', '01014445555', g('F')));
      });
      it('a new member cannot start active, linked, VIP or blocked', async () => {
        const patch = (p: Data) => (ops: WriteOp[]) => ops.map((o) => (o.path.startsWith('members/') ? { ...o, data: { ...o.data, ...p } } : o));
        await denied(registerAs(CASHIER, 'منى حسن', '01014445555', patch({ accountStatus: 'ACTIVE' })));
        await denied(registerAs(CASHIER, 'منى حسن', '01014445555', patch({ authUid: 'u-x' })));
        await denied(registerAs(CASHIER, 'منى حسن', '01014445555', patch({ vipTierId: 'ELITE' })));
        await denied(registerAs(CASHIER, 'منى حسن', '01014445555', patch({ blocks: { CHECKIN_BLOCK: {} } })));
      });
      it('an expired licence stops staff writes; the developer still works with a second factor', async () => {
        await h.seed({ 'license/main': { ...world(Date.now())['license/main'], endsAt: new Date(Date.now() - H) } });
        await denied(registerAs(CASHIER, 'منى حسن', '01014445555'));
        await denied(registerAs(DEV_NO_MFA, 'منى حسن', '01014445555'));
        await ok(registerAs(DEV, 'منى حسن', '01014445555'));
      });
    });

    describe('invites', () => {
      const pending = { id: 'mem2', fullName: 'سارة محمود', phoneE164: PHONE_MEM2, authUid: null };
      const active = { id: 'mem1', fullName: 'أحمد علي', phoneE164: PHONE_MEM1, authUid: 'u-mem1' };
      const now = () => new Date();

      it('a cashier sends an activation link to a pending member, not to an active one', async () => {
        await ok(h.as(CASHIER).commit(memberInvite({ actorUid: 'cash1', actorRoles: ['cashier'], inviteId: hex64(1), member: pending, purpose: 'activate', now: now() })));
        await denied(h.as(CASHIER).commit(memberInvite({ actorUid: 'cash1', actorRoles: ['cashier'], inviteId: hex64(2), member: { ...active, authUid: null }, purpose: 'activate', now: now() })));
      });
      it('password resets: admin only, with an identity check', async () => {
        const reset = (actor: AuthSpec, roles: string[], id: number, identityCheck: string | null) =>
          h.as(actor).commit([{ type: 'set', path: `invites/${hex64(id)}`, data: { ...memberInvite({ actorUid: 'admin1', actorRoles: ['admin'], inviteId: hex64(id), member: active, purpose: 'reset', identityCheck: 'IN_PERSON', now: now() })[0].data, createdBy: actor.uid, identityCheck } }]);
        await ok(reset(ADMIN, ['admin'], 3, 'IN_PERSON'));
        await denied(reset(CASHIER, ['cashier'], 4, 'IN_PERSON'));
        await denied(reset(ADMIN, ['admin'], 5, null));
      });
      it('coaches and members cannot create invites; links cannot outlive 48 hours', async () => {
        const ops = memberInvite({ actorUid: 'coach1', actorRoles: ['cashier'], inviteId: hex64(6), member: pending, purpose: 'activate', now: now() });
        await denied(h.as(COACH).commit(ops));
        const long = memberInvite({ actorUid: 'cash1', actorRoles: ['cashier'], inviteId: hex64(7), member: pending, purpose: 'activate', now: new Date(Date.now() + 3 * D) });
        await denied(h.as(CASHIER).commit(long));
      });
      it('staff invites: admins add cashiers, coaches and accountants; only the developer (with 2FA) adds admins', async () => {
        const inv = (actor: AuthSpec, actorRoles: string[], roles: string[], id: number, phone = '01512345678') => staffInvite({ actorUid: actor.uid, actorRoles, inviteId: hex64(id), phone, displayName: 'منى', roles, purpose: 'activate', aliasOwner: null, now: now() });
        await ok(h.as(ADMIN).commit(inv(ADMIN, ['admin'], ['cashier'], 10)));
        await denied(h.as(ADMIN).commit(inv(ADMIN, ['developer'], ['admin'], 11)));
        await denied(h.as(CASHIER).commit(inv(CASHIER, ['admin'], ['cashier'], 12)));
        await denied(h.as(DEV_NO_MFA).commit(inv(DEV, ['developer'], ['admin'], 13)));
        await ok(h.as(DEV).commit(inv(DEV, ['developer'], ['admin'], 14)));
        await denied(h.as(ADMIN).commit(inv(ADMIN, ['admin'], ['cashier'], 15, '01511111111')));
      });
      it('anyone with the link can open the invite; nobody but admins can list invites', async () => {
        await h.as(CASHIER).commit(memberInvite({ actorUid: 'cash1', actorRoles: ['cashier'], inviteId: hex64(20), member: pending, purpose: 'activate', now: now() }));
        await ok(h.as(null).get(`invites/${hex64(20)}`));
        await denied(h.as(null).list('invites'));
        await denied(h.as(CASHIER).list('invites'));
        await ok(h.as(ADMIN).list('invites'));
      });
    });

    describe('redeeming invites', () => {
      const pending = { id: 'mem2', fullName: 'سارة محمود', phoneE164: PHONE_MEM2, authUid: null };
      async function memberLink(id: number) {
        await h.as(CASHIER).commit(memberInvite({ actorUid: 'cash1', actorRoles: ['cashier'], inviteId: hex64(id), member: pending, purpose: 'activate', now: new Date() }));
        return inviteData(`invites/${hex64(id)}`, await h.as(null).get(`invites/${hex64(id)}`));
      }
      const NEW = { uid: 'u-new', email: email(100) };
      const redeem = (who: AuthSpec, id: number, inv: InviteDoc) => redeemInvite({ uid: who.uid, email: who.email!, inviteId: hex64(id), invite: inv, now: new Date() });

      it('activation links the new account to the member file and the phone', async () => {
        const inv = await memberLink(30);
        await ok(h.as(NEW).commit(redeem(NEW, 30, inv)));
        expect((await h.peek('members/mem2'))?.authUid).toBe('u-new');
        expect((await h.peek('loginAliases/m+201022222222'))?.uid).toBe('u-new');
        await ok(h.as(NEW).get('members/mem2'));
        await denied(h.as(NEW).get('members/mem1'));
      });
      it('a link works once', async () => {
        const inv = await memberLink(31);
        await h.as(NEW).commit(redeem(NEW, 31, inv));
        const other = { uid: 'u-other', email: email(101) };
        await denied(h.as(other).commit(redeem(other, 31, inv)));
      });
      it('two activation links for the same member: only the first one used counts', async () => {
        const a = await memberLink(38);
        const b = await memberLink(39);
        await ok(h.as(NEW).commit(redeem(NEW, 38, a)));
        const late = { uid: 'u-late', email: email(102) };
        await denied(h.as(late).commit(redeem(late, 39, b)));
        expect((await h.peek('members/mem2'))?.authUid).toBe('u-new');
      });
      it('an expired link does nothing', async () => {
        const inv = await memberLink(32);
        await h.seed({ [`invites/${hex64(32)}`]: { ...inv, createdAt: new Date(), expiresAt: new Date(Date.now() - 1000) } });
        await denied(h.as(NEW).commit(redeem(NEW, 32, { ...inv, expiresAt: new Date(Date.now() + H) })));
      });
      it('the new profile copies the invite exactly (no extra roles)', async () => {
        const inv = await memberLink(33);
        const ops = redeem(NEW, 33, inv).map((o) => (o.path === 'users/u-new' ? { ...o, data: { ...o.data, roles: ['member', 'admin'] } } : o));
        await denied(h.as(NEW).commit(ops));
      });
      it('a profile cannot be created without using an invite in the same write', async () => {
        const inv = await memberLink(34);
        const ops = redeem(NEW, 34, inv).filter((o) => o.path !== `invites/${hex64(34)}`);
        await denied(h.as(NEW).commit(ops));
        await denied(h.as(NEW).commit([{ type: 'set', path: 'users/u-new', data: { kind: 'staff', roles: ['admin'], status: 'active', displayName: 'x', phone: PHONE_CASH, memberId: null, inviteId: 'nope', createdAt: SERVER_TIME } }]));
      });
      it('the phone must point at the account that is signing in', async () => {
        const inv = await memberLink(35);
        const ops = redeem(NEW, 35, inv).map((o) => (o.path.startsWith('loginAliases/') ? { ...o, data: { ...o.data, email: email(555) } } : o));
        await denied(h.as(NEW).commit(ops));
      });
      it('a password reset moves the member to the new account and retires the old one', async () => {
        const active = { id: 'mem1', fullName: 'أحمد علي', phoneE164: PHONE_MEM1, authUid: 'u-mem1' };
        await h.as(ADMIN).commit(memberInvite({ actorUid: 'admin1', actorRoles: ['admin'], inviteId: hex64(36), member: active, purpose: 'reset', identityCheck: 'IN_PERSON', now: new Date() }));
        const inv = inviteData('', await h.as(null).get(`invites/${hex64(36)}`));
        const ops = redeem(NEW, 36, inv);
        await denied(h.as(NEW).commit(ops.filter((o) => o.path !== 'users/u-mem1')));
        await ok(h.as(NEW).commit(ops));
        expect((await h.peek('users/u-mem1'))?.status).toBe('replaced');
        expect((await h.peek('members/mem1'))?.authUid).toBe('u-new');
        await denied(h.as(MEMBER1).get('members/mem1'));
        await ok(h.as(NEW).get('members/mem1'));
      });
      it('staff activation gives exactly the invited roles', async () => {
        await h.as(ADMIN).commit(staffInvite({ actorUid: 'admin1', actorRoles: ['admin'], inviteId: hex64(37), phone: '01512345678', displayName: 'منى', roles: ['cashier'], purpose: 'activate', aliasOwner: null, now: new Date() }));
        const inv = inviteData('', await h.as(null).get(`invites/${hex64(37)}`));
        const S = { uid: 'u-staff', email: semail(200) };
        await ok(h.as(S).commit(redeem(S, 37, inv)));
        expect((await h.peek('users/u-staff'))?.roles).toEqual(['cashier']);
        // Staff powers start only after the 4-digit code opens a session.
        await denied(h.as(S).get('members/mem1'));
      });
    });

    describe('staff management', () => {
      const target = (uid: string, roles: string[], status = 'active') => ({ uid, roles, status, kind: 'staff' });
      it('an admin disables a cashier, who then loses access', async () => {
        await ok(h.as(ADMIN).commit(updateStaff({ actorUid: 'admin1', actorRoles: ['admin'], auditId: 'au-1', target: target('cash1', ['cashier']), status: 'disabled' })));
        await denied(h.as(CASHIER).get('members/mem1'));
      });
      it('admins cannot touch other admins, promote to admin, or edit themselves', async () => {
        const raw = (uid: string, data: Data, aid: string) => [
          { type: 'update' as const, path: `users/${uid}`, data: { ...data, updatedAt: SERVER_TIME, lastAuditId: aid } },
          { type: 'set' as const, path: `auditLogs/${aid}`, data: { actorUid: 'admin1', action: 'staff.update', entityType: 'users', entityId: uid, at: SERVER_TIME, summary: {} } },
        ];
        await denied(h.as(ADMIN).commit(raw('admin2', { status: 'disabled' }, 'au-2')));
        await denied(h.as(ADMIN).commit(raw('cash1', { roles: ['admin'] }, 'au-3')));
        await denied(h.as(ADMIN).commit(raw('admin1', { roles: ['admin', 'cashier'] }, 'au-4')));
      });
      it('the developer (with 2FA) manages admins', async () => {
        await denied(h.as(DEV_NO_MFA).commit(updateStaff({ actorUid: 'dev', actorRoles: ['developer'], auditId: 'au-5', target: target('admin2', ['admin']), status: 'disabled' })));
        await ok(h.as(DEV).commit(updateStaff({ actorUid: 'dev', actorRoles: ['developer'], auditId: 'au-6', target: target('admin2', ['admin']), status: 'disabled' })));
      });
      it('nobody edits their own profile or roles', async () => {
        await denied(h.as(CASHIER).commit([{ type: 'update', path: 'users/cash1', data: { roles: ['admin'] } }]));
        await denied(h.as(MEMBER1).commit([{ type: 'update', path: 'users/u-mem1', data: { roles: ['member', 'admin'] } }]));
      });
    });

    describe('reading', () => {
      it('members read only their own file, and not while blocked', async () => {
        await ok(h.as(MEMBER1).get('members/mem1'));
        await denied(h.as(MEMBER1).get('members/mem2'));
        await denied(h.as(MEMBER3).get('members/mem3'));
        await denied(h.as(MEMBER1).list('members'));
      });
      it('coaches read their own trainees only', async () => {
        await ok(h.as(COACH).get('members/mem1'));
        await denied(h.as(COACH).get('members/mem2'));
        await ok(h.as(COACH).list('members', 'assignedCoachId', 'coach1'));
      });
      it('public: gym identity and single sign-in lookups; nothing else', async () => {
        await ok(h.as(null).get('gymPublicConfig/main'));
        await ok(h.as(null).get('loginAliases/m+201011111111'));
        await denied(h.as(null).list('loginAliases'));
        await denied(h.as(null).get('license/main'));
        await denied(h.as(null).get('members/mem1'));
        await denied(h.as(null).get('users/u-mem1'));
      });
      it('the audit log is for admins', async () => {
        await ok(h.as(ADMIN).get('auditLogs/seed-a'));
        await denied(h.as(CASHIER).get('auditLogs/seed-a'));
      });
    });

    describe('blocks', () => {
      it('admins block and unblock with an audit entry; cashiers cannot', async () => {
        const add = setMemberBlock({ actorUid: 'admin1', auditId: 'blk-1', memberId: 'mem1', blocks: {}, scope: 'LOGIN_BLOCK', reasonCode: 'MISCONDUCT', note: '', until: null, now: new Date() });
        await denied(h.as(CASHIER).commit(add.map((o) => (o.path.startsWith('auditLogs') ? { ...o, data: { ...o.data, actorUid: 'cash1' } } : o))));
        await ok(h.as(ADMIN).commit(add));
        await denied(h.as(MEMBER1).get('members/mem1'));
        const blocks = (await h.peek('members/mem1'))?.blocks as Record<string, never>;
        await ok(h.as(ADMIN).commit(liftMemberBlock({ actorUid: 'admin1', auditId: 'blk-2', memberId: 'mem1', blocks, scope: 'LOGIN_BLOCK', note: 'ok' })));
        await ok(h.as(MEMBER1).get('members/mem1'));
      });
      it('a temporary suspension ends by itself', async () => {
        await h.seed({ 'members/mem3': { ...world(Date.now())['members/mem3'], blocks: { TEMPORARY_SUSPENSION: { reasonCode: 'X', note: '', until: new Date(Date.now() - 1000), by: 'admin1', at: new Date() } } } });
        await ok(h.as(MEMBER3).get('members/mem3'));
      });
      it('unknown block types are refused', async () => {
        const add = setMemberBlock({ actorUid: 'admin1', auditId: 'blk-3', memberId: 'mem1', blocks: {}, scope: 'LOGIN_BLOCK', reasonCode: 'MISCONDUCT', note: '', until: null, now: new Date() });
        await denied(h.as(ADMIN).commit(add.map((o) => (o.path === 'members/mem1' ? { ...o, data: { ...o.data, blocks: { EVERYTHING: {} } } } : o))));
      });
    });

    describe('licence and branding (developer, 2FA)', () => {
      const lic = (auth: AuthSpec, prevVersion: number, days = 30, type: 'TRIAL' | 'FIXED' | 'LIFETIME' = 'FIXED') =>
        h.as(auth).commit(setLicense({ actorUid: auth.uid, auditId: nextId('lic-'), prevVersion, type, state: 'ACTIVE', startsAt: new Date(), days: type === 'LIFETIME' ? null : days, note: '' }));
      it('versions move by one; admins and developers without 2FA cannot write', async () => {
        await denied(lic(ADMIN, 1));
        await denied(lic(DEV_NO_MFA, 1));
        await denied(lic(DEV, 5));
        await ok(lic(DEV, 1));
        await ok(lic(DEV, 2, 0, 'LIFETIME'));
      });
      it('a trial cannot exceed 60 days', async () => {
        const ops = setLicense({ actorUid: 'dev', auditId: 'lic-x', prevVersion: 1, type: 'FIXED', state: 'ACTIVE', startsAt: new Date(), days: 365, note: '' });
        await denied(h.as(DEV).commit(ops.map((o) => (o.path === 'license/main' ? { ...o, data: { ...o.data, type: 'TRIAL' } } : o))));
      });
      it('branding: developer only, raster logos only', async () => {
        const b = { nameAr: 'بلس', nameEn: 'PULSE', codePrefix: 'PLS', primaryColor: '#E51C35', supportPhone: '01508613866', logoDataUrl: 'data:image/png;base64,iVBORw0KGgo=' };
        await denied(h.as(ADMIN).commit(setBranding({ actorUid: 'admin1', auditId: 'br-1', ...b })));
        await ok(h.as(DEV).commit(setBranding({ actorUid: 'dev', auditId: 'br-2', ...b })));
        const svg = setBranding({ actorUid: 'dev', auditId: 'br-3', ...b }).map((o) => (o.path === 'gymPublicConfig/main' ? { ...o, data: { ...o.data, logoDataUrl: 'data:image/svg+xml;base64,PHN2Zz4=' } } : o));
        await denied(h.as(DEV).commit(svg));
      });
    });

    describe('staff sign-in code and sessions', () => {
      const FRESH = { uid: 'cash1', email: semail(1), authTime: SIGNED_IN_AT + 500 };
      const tries = async () => ((await h.peek('pinTries/cash1'))?.count as number | undefined) ?? 0;
      const enter = async (pin: string) => {
        await h.as(FRESH).commit(pinAttempt({ uid: 'cash1', pin, authTime: FRESH.authTime, prevCount: await tries() }));
        await h.as(FRESH).commit(openStaffSession({ uid: 'cash1', authTime: FRESH.authTime, device: 'phone' }));
      };
      it('a password alone is not enough: a new sign-in has no staff powers until the code is entered', async () => {
        await denied(h.as(FRESH).get('members/mem1'));
        await denied(registerAs(FRESH, 'منى حسن', '01014445555'));
        await ok(h.as(FRESH).get('users/cash1'));
      });
      it('the right code opens a session for this sign-in; a wrong one does not', async () => {
        await denied(enter('1111'));
        await ok(enter(CASH_PIN));
        await ok(h.as(FRESH).get('members/mem1'));
        await denied(h.as(CASHIER).get('members/mem1'));
        expect(await tries()).toBe(0);
      });
      it('a session cannot be opened without a recorded attempt, or for another sign-in', async () => {
        await denied(h.as(FRESH).commit(openStaffSession({ uid: 'cash1', authTime: FRESH.authTime, device: 'x' })));
        await h.as(FRESH).commit(pinAttempt({ uid: 'cash1', pin: CASH_PIN, authTime: FRESH.authTime, prevCount: 0 }));
        await denied(h.as(FRESH).commit(openStaffSession({ uid: 'cash1', authTime: FRESH.authTime + 1, device: 'x' })));
      });
      it('an attempt belongs to one sign-in and stays private', async () => {
        await denied(h.as(FRESH).commit(pinAttempt({ uid: 'cash1', pin: CASH_PIN, authTime: FRESH.authTime + 7, prevCount: 0 })));
        await h.as(FRESH).commit(pinAttempt({ uid: 'cash1', pin: CASH_PIN, authTime: FRESH.authTime, prevCount: 0 }));
        const other = { ...FRESH, authTime: FRESH.authTime + 60 };
        await denied(h.as(other).commit(openStaffSession({ uid: 'cash1', authTime: other.authTime, device: 'x' })));
        await denied(h.as(COACH).get('pinTries/cash1'));
        await denied(h.as(null).get('pinTries/cash1'));
      });
      it('five wrong codes lock the account until an admin unlocks it', async () => {
        for (let i = 0; i < 5; i++) await denied(enter('0000'));
        expect(await tries()).toBe(5);
        await denied(h.as(FRESH).commit([{ type: 'set', path: 'pinTries/cash1', data: { pin: CASH_PIN, count: 6, authTime: FRESH.authTime, at: SERVER_TIME } }]));
        await denied(h.as(FRESH).commit([{ type: 'set', path: 'pinTries/cash1', data: { pin: CASH_PIN, count: 0, authTime: FRESH.authTime, at: SERVER_TIME } }]));
        await ok(h.as(ADMIN).commit(unlockPin({ actorUid: 'admin1', actorRoles: ['admin'], target: { uid: 'cash1', roles: ['cashier'], status: 'active', kind: 'staff' } })));
        await ok(enter(CASH_PIN));
      });
      it('nobody can read the stored code, not even an admin', async () => {
        await denied(h.as(FRESH).get('pinSecrets/cash1'));
        await denied(h.as(ADMIN).get('pinSecrets/cash1'));
        await denied(h.as(DEV).get('pinSecrets/cash1'));
      });
      it('admins set codes for their staff; not for admins, not for themselves', async () => {
        const pin = (actor: AuthSpec, roles: string[], uid: string, targetRoles: string[], aid: string) =>
          h.as(actor).commit(setStaffPin({ actorUid: actor.uid, actorRoles: roles, auditId: aid, target: { uid, roles: targetRoles, status: 'active', kind: 'staff' }, salt: SALT, hash: sha(SALT + '9999') }));
        await ok(pin(ADMIN, ['admin'], 'cash1', ['cashier'], 'pin-1'));
        await denied(h.as(CASHIER).get('members/mem1'));
        await denied(pin(ADMIN, ['developer'], 'admin2', ['admin'], 'pin-2'));
        await denied(pin(CASHIER, ['admin'], 'coach1', ['coach'], 'pin-3'));
        await ok(pin(DEV, ['developer'], 'admin2', ['admin'], 'pin-4'));
      });
      it('an admin can end a staff session remotely; staff can end their own', async () => {
        await denied(h.as(COACH).commit(endStaffSession('cash1')));
        await ok(h.as(ADMIN).commit(endStaffSession('cash1')));
        await denied(h.as(CASHIER).get('members/mem1'));
        await ok(h.as(COACH).commit(endStaffSession('coach1')));
        await denied(h.as(ADMIN).commit(endStaffSession('admin2')));
      });
      it('removing a staff account frees the phone and ends access', async () => {
        await ok(h.as(ADMIN).commit(removeStaff({ actorUid: 'admin1', actorRoles: ['admin'], auditId: 'rm-1', target: { uid: 'cash1', roles: ['cashier'], status: 'active', kind: 'staff', phone: PHONE_CASH } })));
        expect(await h.peek('loginAliases/s+201511111111')).toBeUndefined();
        await denied(h.as(CASHIER).get('members/mem1'));
        // An admin cannot remove another admin, even by bypassing the app's own check.
        const forged = removeStaff({ actorUid: 'admin1', actorRoles: ['developer'], auditId: 'rm-2', target: { uid: 'admin2', roles: ['admin'], status: 'active', kind: 'staff', phone: '+201500000002' } });
        await denied(h.as(ADMIN).commit(forged));
      });
      it('admins can rename staff', async () => {
        await ok(h.as(ADMIN).commit(updateStaff({ actorUid: 'admin1', actorRoles: ['admin'], auditId: 'nm-1', target: { uid: 'coach1', roles: ['coach'], status: 'active', kind: 'staff' }, displayName: 'كابتن جديد' })));
        expect((await h.peek('users/coach1'))?.displayName).toBe('كابتن جديد');
      });
    });

    describe('developer second step (code + security phrase)', () => {
      const NEW_DEV = { uid: 'dev2', email: 'dev2@urcod.example', authTime: SIGNED_IN_AT + 10 };
      const devUser = { kind: 'developer', roles: ['developer'], status: 'active', displayName: 'Dev 2', phone: null, memberId: null, inviteId: null, createdAt: new Date() };
      const secret = (pin: string, phrase: string) => ({ salt: SALT, hash: sha(SALT + devSecretValue(pin, phrase)) });
      const enter = async (who: AuthSpec, value: string) => {
        const prev = ((await h.peek(`pinTries/${who.uid}`))?.count as number | undefined) ?? 0;
        await h.as(who).commit(pinAttempt({ uid: who.uid, pin: value, authTime: who.authTime!, prevCount: prev }));
        await h.as(who).commit(openStaffSession({ uid: who.uid, authTime: who.authTime!, device: 'pc' }));
      };
      it('a developer without a session has no powers', async () => {
        await denied(h.as(DEV_NO_MFA).get('members/mem1'));
        await denied(h.as(DEV_NO_MFA).commit(setLicense({ actorUid: 'dev', auditId: 'l-x', prevVersion: 1, type: 'TRIAL', state: 'ACTIVE', startsAt: new Date(), days: 7, note: '' })));
      });
      it('first sign-in: the developer sets the code + phrase once, then needs them to open a session', async () => {
        await h.seed({ 'users/dev2': devUser });
        await ok(h.as(NEW_DEV).commit(setDevSecret({ uid: 'dev2', auditId: 'ds-1', ...secret('1234', 'very-strong-phrase') })));
        expect(await h.peek('devSetup/dev2')).toBeTruthy();
        // A second "first setup" (e.g. someone who stole the password later) is refused without a session.
        const other = { ...NEW_DEV, authTime: NEW_DEV.authTime + 50 };
        await denied(h.as(other).commit(setDevSecret({ uid: 'dev2', auditId: 'ds-2', ...secret('0000', 'attacker-phrase-x') })));
        await denied(enter(NEW_DEV, devSecretValue('1234', 'wrong-phrase-here')));
        await ok(enter(NEW_DEV, devSecretValue('1234', 'very-strong-phrase')));
        await ok(h.as(NEW_DEV).get('members/mem1'));
      });
      it('nobody else can set or read the developer secret', async () => {
        await h.seed({ 'users/dev2': devUser });
        await denied(h.as(ADMIN).commit(setDevSecret({ uid: 'dev2', auditId: 'ds-3', ...secret('1111', 'admin-sets-this') })));
        await denied(h.as(ADMIN).commit([
          { type: 'set', path: 'pinSecrets/dev', data: { salt: SALT, hash: sha('x'), setBy: 'admin1', setAt: SERVER_TIME, lastAuditId: 'ds-4' } },
          { type: 'set', path: 'auditLogs/ds-4', data: { actorUid: 'admin1', action: 'staff.pin', entityType: 'pinSecrets', entityId: 'dev', at: SERVER_TIME, summary: {} } },
        ]));
        await denied(h.as(DEV).get('pinSecrets/dev'));
      });
    });

    describe('Phase 6: books and cash', () => {
      const entry = { kind: 'EXPENSE' as const, category: 'rent' as const, amount: 1500000, method: 'BANK' as const, date: '2026-10-01', note: 'إيجار أكتوبر' };
      it('the accountant and the admin record expenses; a cashier cannot; nobody edits or deletes them', async () => {
        await ok(h.as(ACCOUNTANT).commit(addFinanceEntry({ actorUid: 'acc1', auditId: nextId('fe-'), entryId: 'fe1', entry })));
        await ok(h.as(ADMIN).commit(addFinanceEntry({ actorUid: 'admin1', auditId: nextId('fe-'), entryId: 'fe2', entry: { ...entry, kind: 'INCOME', category: 'products', amount: 25000 } })));
        await denied(h.as(CASHIER).commit(addFinanceEntry({ actorUid: 'cash1', auditId: nextId('fe-'), entryId: 'fe3', entry })));
        await denied(h.as(ADMIN).commit([{ type: 'update', path: 'financeEntries/fe1', data: { amount: 1 } }]));
        await denied(h.as(ADMIN).commit([{ type: 'delete', path: 'financeEntries/fe1' }]));
      });
      it('a wrong category or amount is refused', async () => {
        const ops = addFinanceEntry({ actorUid: 'acc1', auditId: 'fe-x', entryId: 'fe4', entry });
        (ops[0].data as Record<string, unknown>).category = 'products';
        await denied(h.as(ACCOUNTANT).commit(ops));
        const neg = addFinanceEntry({ actorUid: 'acc1', auditId: 'fe-y', entryId: 'fe5', entry });
        (neg[0].data as Record<string, unknown>).amount = -5;
        await denied(h.as(ACCOUNTANT).commit(neg));
      });
      it('only an admin voids an entry, with a reason, once', async () => {
        await ok(h.as(ACCOUNTANT).commit(addFinanceEntry({ actorUid: 'acc1', auditId: nextId('fe-'), entryId: 'fe6', entry })));
        await denied(h.as(ACCOUNTANT).commit(voidFinanceEntry({ actorUid: 'acc1', auditId: nextId('fv-'), entryId: 'fe6', reason: 'غلط' })));
        await ok(h.as(ADMIN).commit(voidFinanceEntry({ actorUid: 'admin1', auditId: nextId('fv-'), entryId: 'fe6', reason: 'اتسجل مرتين' })));
        await denied(h.as(ADMIN).commit(voidFinanceEntry({ actorUid: 'admin1', auditId: nextId('fv-'), entryId: 'fe6', reason: 'تاني' })));
      });
      it('a cashier closes their own drawer once a day; the difference is computed, not typed', async () => {
        await ok(h.as(CASHIER).commit(closeCash({ actorUid: 'cash1', auditId: nextId('cc-'), date: '2026-10-15', expected: 500000, counted: 490000, note: '' })));
        await denied(h.as(CASHIER).commit(closeCash({ actorUid: 'cash1', auditId: nextId('cc-'), date: '2026-10-15', expected: 500000, counted: 500000, note: '' })));
        const fake = closeCash({ actorUid: 'cash1', auditId: 'cc-x', date: '2026-10-16', expected: 500000, counted: 490000, note: '' });
        (fake[0].data as Record<string, unknown>).diff = 0;
        await denied(h.as(CASHIER).commit(fake));
        const other = closeCash({ actorUid: 'cash1', auditId: 'cc-y', date: '2026-10-17', expected: 0, counted: 0, note: '' });
        (other[0] as { path: string }).path = 'cashCloses/admin1_2026-10-17';
        (other[1].data as Record<string, unknown>).entityId = 'admin1_2026-10-17';
        await denied(h.as(CASHIER).commit(other));
      });
    });

    describe('Phase 5: coaches and programmes', () => {
      const plan: WorkoutPlan = { title: 'تضخيم', days: [{ day: 0, focus: 'صدر', exercises: [{ name: 'بنش', sets: 4, reps: '8-10', rest: 90, target: '60 kg' }] }], notes: '' };
      it('the assigned coach writes the plan; another coach or a cashier cannot', async () => {
        await ok(h.as(COACH).commit(setWorkoutPlan({ actorUid: 'coach1', memberId: 'mem1', coachId: 'coach1', plan })));
        await ok(h.as(COACH).commit(setNutritionPlan({ actorUid: 'coach1', memberId: 'mem1', coachId: 'coach1', plan: { title: 'تغذية', meals: [{ name: 'فطار', items: 'بيض وشوفان' }], notes: '' } })));
        await denied(h.as(COACH).commit(setWorkoutPlan({ actorUid: 'coach1', memberId: 'mem2', coachId: 'coach1', plan })));
        await denied(h.as(CASHIER).commit(setWorkoutPlan({ actorUid: 'cash1', memberId: 'mem1', coachId: 'cash1', plan })));
        await ok(h.as(ADMIN).commit(setWorkoutPlan({ actorUid: 'admin1', memberId: 'mem2', coachId: 'coach1', plan })));
      });
      it('the member reads their own plan, not someone else\'s', async () => {
        await ok(h.as(COACH).commit(setWorkoutPlan({ actorUid: 'coach1', memberId: 'mem1', coachId: 'coach1', plan })));
        await ok(h.as(MEMBER1).get('workoutPlans/mem1'));
        await h.seed({ 'workoutPlans/mem3': { memberId: 'mem3', coachId: 'coach1', title: 'x', days: [], notes: '', updatedAt: new Date(), by: 'coach1' } });
        await denied(h.as(MEMBER1).get('workoutPlans/mem3'));
      });
      it('members log their own workouts and weight only; the coach reads them', async () => {
        await ok(h.as(MEMBER1).commit(setWorkoutDay({ memberId: 'mem1', days: {}, date: '2026-10-15', done: [0, 1] })));
        await ok(h.as(MEMBER1).commit(addWeight({ memberId: 'mem1', entries: [], date: '2026-10-15', kg: 84.2 })));
        await denied(h.as(MEMBER3).commit(setWorkoutDay({ memberId: 'mem1', days: {}, date: '2026-10-15', done: [0] })));
        await ok(h.as(COACH).get('workoutLogs/mem1'));
        await ok(h.as(COACH).get('bodyLogs/mem1'));
        await denied(h.as(CASHIER).get('bodyLogs/mem1'));
        // Another coach does not see this coach's trainee.
        await h.seed({ 'users/coach2': staffUser(['coach'], '+201500000009'), 'staffSessions/coach2': session(Date.now()) });
        await denied(h.as({ uid: 'coach2', email: semail(9) }).get('bodyLogs/mem1'));
      });
      it('only the admin assigns a coach, and only to a real coach account', async () => {
        await ok(h.as(ADMIN).commit(assignCoach({ actorUid: 'admin1', auditId: nextId('ac-'), memberId: 'mem2', coach: { uid: 'coach1', name: 'موظف' } })));
        expect((await h.peek('members/mem2'))?.assignedCoachId).toBe('coach1');
        await denied(h.as(ADMIN).commit(assignCoach({ actorUid: 'admin1', auditId: nextId('ac-'), memberId: 'mem2', coach: { uid: 'cash1', name: 'موظف' } })));
        await denied(h.as(CASHIER).commit(assignCoach({ actorUid: 'cash1', auditId: nextId('ac-'), memberId: 'mem2', coach: { uid: 'coach1', name: 'موظف' } })));
      });
      it('coaches build the exercise library; members cannot', async () => {
        await ok(h.as(COACH).commit(setLibraryExercise({ actorUid: 'coach1', id: 'bench', doc: { nameAr: 'بنش برس', nameEn: 'Bench press', muscle: 'chest', tips: '' } })));
        await denied(h.as(MEMBER1).commit(setLibraryExercise({ actorUid: 'u-mem1', id: 'squat', doc: { nameAr: 'سكوات', nameEn: 'Squat', muscle: 'legs', tips: '' } })));
      });
    });

    describe('Phase 4: check-in at the door', () => {
      const H1 = 3600_000;
      const summary = (over: Partial<MembershipSummary> = {}): MembershipSummary => ({
        id: 'ms-x', planNameAr: 'شهر', planNameEn: '1 month', unit: 'month',
        startsAt: new Date(Date.now() - 5 * D), endsAt: new Date(Date.now() + 20 * D), status: 'ACTIVE', visitQuota: null, visitsUsed: 0, prev: null, ...over,
      });
      const MEMBER2 = { uid: 'u-mem2', email: email(2) };
      const seedMember = async (over: Record<string, unknown> = {}) => {
        await h.seed({
          'members/mem2': { ...member('mem2', 10002, 'سارة محمود', PHONE_MEM2, 'u-mem2', null), membership: summary(), balance: null, lastPaymentId: null, lastCheckInAt: null, lastCheckinId: null, ...over },
          'users/u-mem2': { kind: 'member', roles: ['member'], status: 'active', displayName: 'سارة', phone: PHONE_MEM2, memberId: 'mem2', inviteId: 'seed', createdAt: new Date() },
        });
      };
      const em = async (): Promise<EntryMember> => {
        const m = (await h.peek('members/mem2')) as Record<string, unknown>;
        const toDate = (v: unknown) => (v == null ? null : v instanceof Date ? v : (v as { toDate(): Date }).toDate());
        const c = m.membership as Record<string, unknown>;
        return {
          id: 'mem2',
          membership: { ...(c as unknown as MembershipSummary), startsAt: toDate(c.startsAt)!, endsAt: toDate(c.endsAt)!, prev: null },
          balance: null,
          blocks: {},
          lastCheckInAt: toDate(m.lastCheckInAt),
        };
      };
      const scan = async (who: AuthSpec, code: string, counts = false) =>
        h.as(who).commit(checkIn({ actorUid: who.uid, checkinId: nextId('ci-'), member: await em(), method: 'QR', code, counts }) as Op[]);

      describe('men / ladies', () => {
        const ALL_DAY = Array.from({ length: 24 }, (_, i) => i);
        const settingsWith = (genderMode: 'MIXED' | 'SPLIT_HOURS' | 'SEPARATE', ladiesHours: Record<string, number[]>) =>
          h.seed({ 'gymSettings/main': { ...DEFAULT_GYM_SETTINGS, genderMode, ladiesHours, updatedAt: new Date(), lastAuditId: 'seed-gs' } });
        const manualIn = async () => h.as(CASHIER).commit(checkIn({ actorUid: 'cash1', checkinId: nextId('ci-'), member: await em(), method: 'MANUAL', code: null, counts: false }) as Op[]);
        const everyDay = Object.fromEntries(['0', '1', '2', '3', '4', '5', '6'].map((d) => [d, ALL_DAY]));
        it("ladies' hours: only ladies then, only men otherwise; a member with no gender waits until it is set", async () => {
          await settingsWith('SPLIT_HOURS', everyDay);
          await seedMember({ gender: 'F' });
          await ok(manualIn());
          await seedMember({ gender: 'M' });
          await denied(manualIn());
          await seedMember({ gender: null });
          await denied(manualIn());
          await settingsWith('SPLIT_HOURS', {});
          await seedMember({ gender: 'M' });
          await ok(manualIn());
          await seedMember({ gender: 'F' });
          await denied(manualIn());
          await settingsWith('MIXED', everyDay);
          await seedMember({ gender: 'M' });
          await ok(manualIn());
        });
        it("ladies' hours follow the gym's weekday (Cairo time)", async () => {
          const cairo = DateTime.now().setZone('Africa/Cairo');
          if (cairo.hour === 0 || cairo.hour >= 23) return; // the two possible UTC offsets straddle midnight
          await settingsWith('SPLIT_HOURS', { [String(cairo.weekday % 7)]: ALL_DAY });
          await seedMember({ gender: 'F' });
          await ok(manualIn());
          await settingsWith('SPLIT_HOURS', { [String((cairo.weekday + 1) % 7)]: ALL_DAY });
          await seedMember({ gender: 'F' });
          await denied(manualIn());
        });
        it('the front desk sets men / ladies on a file (with its audit entry); a coach cannot', async () => {
          await seedMember();
          await ok(h.as(CASHIER).commit(setMemberGender({ actorUid: 'cash1', auditId: nextId('mg-'), memberId: 'mem2', gender: 'F' })));
          expect((await h.peek('members/mem2'))?.gender).toBe('F');
          await denied(h.as(COACH).commit(setMemberGender({ actorUid: 'coach1', auditId: nextId('mg-'), memberId: 'mem2', gender: 'M' })));
          const bad = setMemberGender({ actorUid: 'cash1', auditId: nextId('mg-'), memberId: 'mem2', gender: 'M' });
          (bad[0].data as Record<string, unknown>).gender = 'X';
          await denied(h.as(CASHIER).commit(bad));
        });
        it("separate ladies' section: a member's coach is of the same section", async () => {
          await settingsWith('SEPARATE', {});
          await ok(h.as(ADMIN).commit(updateStaff({ actorUid: 'admin1', actorRoles: ['admin'], auditId: nextId('sg-'), target: { uid: 'coach1', roles: ['coach'], status: 'active', kind: 'staff' }, gender: 'M' })));
          await seedMember({ gender: 'F' });
          await denied(h.as(ADMIN).commit(assignCoach({ actorUid: 'admin1', auditId: nextId('ac-'), memberId: 'mem2', coach: { uid: 'coach1', name: 'موظف' } })));
          await seedMember({ gender: null });
          await denied(h.as(ADMIN).commit(assignCoach({ actorUid: 'admin1', auditId: nextId('ac-'), memberId: 'mem2', coach: { uid: 'coach1', name: 'موظف' } })));
          await seedMember({ gender: 'M' });
          await ok(h.as(ADMIN).commit(assignCoach({ actorUid: 'admin1', auditId: nextId('ac-'), memberId: 'mem2', coach: { uid: 'coach1', name: 'موظف' } })));
        });
      });

      it('the member writes a code; the cashier scans it once; a second scan of the same code is refused', async () => {
        await seedMember();
        await ok(h.as(MEMBER2).commit(writeToken('mem2', 'ABCD2345')));
        await ok(scan(CASHIER, 'ABCD2345'));
        expect((await h.peek('members/mem2'))?.lastCheckinId).toBeTruthy();
        await h.seed({ 'members/mem2': { ...((await h.peek('members/mem2')) as Record<string, unknown>), lastCheckInAt: new Date(Date.now() - H1) } });
        await denied(scan(CASHIER, 'ABCD2345'));
      });
      it('a wrong or stale code is refused; a member cannot write someone else\'s code', async () => {
        await seedMember();
        await ok(h.as(MEMBER2).commit(writeToken('mem2', 'ABCD2345')));
        await denied(scan(CASHIER, 'ZZZZ2345'));
        await h.seed({ 'checkinTokens/mem2': { code: 'ABCD2345', at: new Date(Date.now() - 5 * 60_000), usedAt: null } });
        await denied(scan(CASHIER, 'ABCD2345'));
        await denied(h.as(MEMBER1).commit(writeToken('mem2', 'HACK2345')));
      });
      it('no entry when expired, not started, blocked, or with a late balance (unless an admin allowed it)', async () => {
        const manual = async () => h.as(CASHIER).commit(checkIn({ actorUid: 'cash1', checkinId: nextId('ci-'), member: await em(), method: 'MANUAL', code: null, counts: false }) as Op[]);
        await seedMember({ membership: summary({ startsAt: new Date(Date.now() - 40 * D), endsAt: new Date(Date.now() - D) }) });
        await denied(manual());
        await seedMember({ membership: summary({ startsAt: new Date(Date.now() + 2 * D), endsAt: new Date(Date.now() + 30 * D) }) });
        await denied(manual());
        await seedMember({ blocks: { CHECKIN_BLOCK: { reasonCode: 'X', note: '', until: null, by: 'admin1', at: new Date() } } });
        await denied(manual());
        const late = { remaining: 500, total: 1000, dueAt: new Date(Date.now() - H1), membershipId: 'ms-x', graceUntil: null, graceReason: '' };
        await seedMember({ balance: late });
        await denied(manual());
        await seedMember({ balance: { ...late, graceUntil: new Date(Date.now() + D), graceReason: 'وعد' } });
        await ok(manual());
      });
      it('a limited plan counts each visit and stops at the limit; the counter moves by one only', async () => {
        await seedMember({ membership: summary({ unit: 'session', visitQuota: 1, visitsUsed: 0, endsAt: new Date(Date.now() + 10 * H1) }) });
        const ops = checkIn({ actorUid: 'cash1', checkinId: nextId('ci-'), member: await em(), method: 'MANUAL', code: null, counts: true }) as Op[];
        (ops[1] as { data: Record<string, unknown> }).data['membership.visitsUsed'] = 0;
        await denied(h.as(CASHIER).commit(ops));
        await ok(h.as(CASHIER).commit(checkIn({ actorUid: 'cash1', checkinId: nextId('ci-'), member: await em(), method: 'MANUAL', code: null, counts: true }) as Op[]));
        expect(((await h.peek('members/mem2'))?.membership as { visitsUsed: number }).visitsUsed).toBe(1);
        await h.seed({ 'members/mem2': { ...((await h.peek('members/mem2')) as Record<string, unknown>), lastCheckInAt: new Date(Date.now() - H1) } });
        await denied(h.as(CASHIER).commit(checkIn({ actorUid: 'cash1', checkinId: nextId('ci-'), member: await em(), method: 'MANUAL', code: null, counts: true }) as Op[]));
      });
      it('an old check-in cannot be replayed to use up visits or block the door', async () => {
        await seedMember({ membership: summary({ unit: 'session', visitQuota: 5, visitsUsed: 0, endsAt: new Date(Date.now() + 10 * H1) }) });
        const ops = checkIn({ actorUid: 'cash1', checkinId: nextId('ci-'), member: await em(), method: 'MANUAL', code: null, counts: true }) as Op[];
        await ok(h.as(CASHIER).commit(ops));
        const old = (ops[0] as { path: string }).path.split('/')[1];
        await h.seed({ [`checkins/${old}`]: { ...((await h.peek(`checkins/${old}`)) as Record<string, unknown>), at: new Date(Date.now() - H1) } });
        await h.seed({ 'members/mem2': { ...((await h.peek('members/mem2')) as Record<string, unknown>), lastCheckInAt: new Date(Date.now() - H1), lastCheckinId: 'other' } });
        const used = ((await h.peek('members/mem2'))?.membership as { visitsUsed: number }).visitsUsed;
        for (const who of [COACH, CASHIER]) {
          await denied(h.as(who).commit([{ type: 'update', path: 'members/mem2', data: { lastCheckInAt: SERVER_TIME, lastCheckinId: old, 'membership.visitsUsed': used + 1 } }]));
          await denied(h.as(who).commit([{ type: 'update', path: 'members/mem2', data: { lastCheckInAt: SERVER_TIME, lastCheckinId: old } }]));
        }
      });
      it('not twice within two minutes; coaches and members cannot check anyone in', async () => {
        await seedMember({ lastCheckInAt: new Date(Date.now() - 30_000) });
        await denied(h.as(CASHIER).commit(checkIn({ actorUid: 'cash1', checkinId: nextId('ci-'), member: await em(), method: 'MANUAL', code: null, counts: false }) as Op[]));
        await seedMember();
        await denied(h.as(COACH).commit(checkIn({ actorUid: 'coach1', checkinId: nextId('ci-'), member: await em(), method: 'MANUAL', code: null, counts: false }) as Op[]));
        await denied(h.as(MEMBER2).commit(checkIn({ actorUid: 'u-mem2', checkinId: nextId('ci-'), member: await em(), method: 'MANUAL', code: null, counts: false }) as Op[]));
      });
    });

    describe('Phase 4: VIP', () => {
      it('an admin sets tier perks and a member\'s tier; a cashier cannot', async () => {
        await ok(h.as(ADMIN).commit(setVipTier({ actorUid: 'admin1', auditId: nextId('vt-'), tier: 'ELITE', doc: { nameAr: 'إيليت', nameEn: 'Elite', perksAr: 'قياسات مجانية', perksEn: 'Free assessments' } })));
        await ok(h.as(ADMIN).commit(setMemberVip({ actorUid: 'admin1', auditId: nextId('mv-'), memberId: 'mem1', tier: 'ELITE' })));
        expect((await h.peek('members/mem1'))?.vipTierId).toBe('ELITE');
        await denied(h.as(CASHIER).commit(setMemberVip({ actorUid: 'cash1', auditId: nextId('mv-'), memberId: 'mem2', tier: 'PLUS' })));
        const bad = setMemberVip({ actorUid: 'admin1', auditId: nextId('mv-'), memberId: 'mem2', tier: 'PLUS' });
        (bad[0].data as Record<string, unknown>).vipTierId = 'GOLD';
        await denied(h.as(ADMIN).commit(bad));
      });
    });

    describe('Phase 3: banners (admin) shown to members', () => {
      const banner: BannerDoc = { title: 'عرض الشهر', body: 'خصم 10%', tag: 'عرض', tone: 'primary', figure: 'flex', status: 'PUBLISHED', vipOnly: false, sort: 0, endsAt: null };
      it('an admin publishes a banner; a cashier cannot; members read only published ones', async () => {
        await ok(h.as(ADMIN).commit(setBanner({ actorUid: 'admin1', auditId: nextId('bn-'), bannerId: 'b1', banner })));
        await ok(h.as(ADMIN).commit(setBanner({ actorUid: 'admin1', auditId: nextId('bn-'), bannerId: 'b2', banner: { ...banner, status: 'DRAFT' } })));
        await denied(h.as(CASHIER).commit(setBanner({ actorUid: 'cash1', auditId: nextId('bn-'), bannerId: 'b3', banner })));
        await ok(h.as(MEMBER1).get('banners/b1'));
        await denied(h.as(MEMBER1).get('banners/b2'));
      });
      it('a banner cannot carry an outside picture or a long text', async () => {
        const ops = setBanner({ actorUid: 'admin1', auditId: 'bn-x', bannerId: 'b4', banner });
        (ops[0].data as Record<string, unknown>).figure = 'https://evil.example/x.png';
        await denied(h.as(ADMIN).commit(ops));
      });
    });

    describe('in-app notices (admin → members)', () => {
      const MEMBER2N = { uid: 'u-mem2', email: email(2) };
      const seedMember2 = () =>
        h.seed({
          'members/mem2': { ...member('mem2', 10002, 'سارة محمود', PHONE_MEM2, 'u-mem2', null) },
          'users/u-mem2': { kind: 'member', roles: ['member'], status: 'active', displayName: 'سارة', phone: PHONE_MEM2, memberId: 'mem2', inviteId: 'seed', createdAt: new Date() },
        });
      const send = (who: AuthSpec, actorUid: string, noticeId: string, input: NoticeInput) => sendNotice({ actorUid, auditId: nextId('nt-'), noticeId, input });
      it('an admin sends to everyone; members read it and mark it read once; a cashier cannot send', async () => {
        const r = send(ADMIN, 'admin1', 'n-all', { title: 'تغيير المواعيد', body: 'الجيم بيفتح 7 الصبح من السبت', audience: 'ALL', memberIds: [] });
        expect(r.rest).toHaveLength(0);
        await ok(h.as(ADMIN).commit(r.first));
        await denied(h.as(CASHIER).commit(send(CASHIER, 'cash1', 'n-c', { title: 'تجربة', body: 'x', audience: 'ALL', memberIds: [] }).first));
        await ok(h.as(MEMBER1).get('notices/n-all'));
        expect((await h.as(MEMBER1).list('notices', 'public', true)).length).toBeGreaterThan(0);
        await ok(h.as(MEMBER1).commit(readNotice({ noticeId: 'n-all', memberId: 'mem1' })));
        await denied(h.as(MEMBER1).commit(readNotice({ noticeId: 'n-all', memberId: 'mem1' })));
        await denied(h.as(MEMBER1).commit(readNotice({ noticeId: 'n-all', memberId: 'mem2' })));
        await denied(h.as(MEMBER1).commit(readNotice({ noticeId: 'n-none', memberId: 'mem1' })));
        await h.seed({ 'noticeReads/n-all_mem2': { noticeId: 'n-all', memberId: 'mem2', at: new Date() } });
        expect(await h.as(ADMIN).list('noticeReads', 'noticeId', 'n-all')).toHaveLength(2);
        // a member cannot see who else read it
        await denied(h.as(MEMBER1).list('noticeReads', 'noticeId', 'n-all'));
        expect(await h.as(MEMBER1).list('noticeReads', 'memberId', 'mem1')).toHaveLength(1);
      });
      it('a notice to chosen members reaches only them', async () => {
        await seedMember2();
        const r = send(ADMIN, 'admin1', 'n-list', { title: 'باقي الاشتراك', body: 'من فضلك كمّل الباقي', audience: 'LIST', memberIds: ['mem2'] });
        await ok(h.as(ADMIN).commit(r.first));
        for (const c of r.rest) await ok(h.as(ADMIN).commit(c));
        await denied(h.as(MEMBER1).get('notices/n-list'));
        await denied(h.as(MEMBER2N).get('notices/n-list'));
        // a full write of copies stays inside the rules budget
        const many = send(ADMIN, 'admin1', 'n-many', { title: 'تنبيه', body: 'للمجموعة', audience: 'LIST', memberIds: ['mem1', 'mem2', 'mem3'] });
        await ok(h.as(ADMIN).commit(many.first));
        expect(many.rest[0]).toHaveLength(3);
        await ok(h.as(ADMIN).commit(many.rest[0]));
        expect(await h.as(MEMBER2N).list('inbox', 'memberId', 'mem2')).toHaveLength(2);
        await denied(h.as(MEMBER1).list('inbox', 'memberId', 'mem2'));
        await ok(h.as(MEMBER2N).commit(readNotice({ noticeId: 'n-list', memberId: 'mem2' })));
        // copies must match the notice, go to real members, and come from its author
        const bad = send(ADMIN, 'admin1', 'n-list', { title: 'باقي الاشتراك', body: 'نص تاني', audience: 'LIST', memberIds: ['mem1'] }).rest[0];
        await denied(h.as(ADMIN).commit(bad));
        await denied(h.as(ADMIN).commit(send(ADMIN, 'admin1', 'n-list', { title: 'باقي الاشتراك', body: 'من فضلك كمّل الباقي', audience: 'LIST', memberIds: ['ghost'] }).rest[0]));
        await denied(h.as(CASHIER).commit(send(CASHIER, 'cash1', 'n-list', { title: 'باقي الاشتراك', body: 'من فضلك كمّل الباقي', audience: 'LIST', memberIds: ['mem1'] }).rest[0]));
        // a "public" flag cannot be forced on a chosen-members notice
        const leak = send(ADMIN, 'admin1', 'n-leak', { title: 'سري', body: 'x', audience: 'LIST', memberIds: ['mem2'] });
        (leak.first[0].data as Record<string, unknown>).public = true;
        await denied(h.as(ADMIN).commit(leak.first));
      });
      it('only an admin archives a notice', async () => {
        await ok(h.as(ADMIN).commit(send(ADMIN, 'admin1', 'n-arc', { title: 'عرض', body: 'خصم', audience: 'VIP', memberIds: [] }).first));
        await denied(h.as(CASHIER).commit(archiveNotice({ actorUid: 'cash1', auditId: nextId('na-'), noticeId: 'n-arc' })));
        await ok(h.as(ADMIN).commit(archiveNotice({ actorUid: 'admin1', auditId: nextId('na-'), noticeId: 'n-arc' })));
        expect((await h.peek('notices/n-arc'))?.status).toBe('ARCHIVED');
      });
    });

    describe('Phase 3: plans and settings (admin)', () => {
      it('an admin saves a plan and the settings; a cashier cannot', async () => {
        const plan: PlanDoc = { ...PLAN_M1, code: 'M3', nameAr: '3 شهور', nameEn: '3 months', value: 3, price: 270000 };
        await ok(h.as(ADMIN).commit(setPlan({ actorUid: 'admin1', auditId: nextId('pl-'), planId: 'p_m3', plan })));
        await denied(h.as(CASHIER).commit(setPlan({ actorUid: 'cash1', auditId: nextId('pl-'), planId: 'p_m3', plan: { ...plan, price: 100 } })));
        await ok(h.as(ADMIN).commit(setGymSettings({ actorUid: 'admin1', auditId: nextId('gs-'), settings: { ...DEFAULT_GYM_SETTINGS, cashierMaxDiscount: 20 } })));
        await denied(h.as(CASHIER).commit(setGymSettings({ actorUid: 'cash1', auditId: nextId('gs-'), settings: { ...DEFAULT_GYM_SETTINGS, cashierMaxDiscount: 100 } })));
      });
      it('a custom-length plan cannot carry a fixed price', async () => {
        const ops = setPlan({ actorUid: 'admin1', auditId: 'pl-x', planId: 'p_custom', plan: PLAN_CUSTOM });
        (ops[0].data as Record<string, unknown>).price = 5000;
        await denied(h.as(ADMIN).commit(ops));
      });
    });

    describe('Phase 3: selling memberships', () => {
      const base = (over: Partial<SaleInput> = {}): SaleInput => ({
        actorUid: 'cash1',
        actorIsAdmin: false,
        membershipId: nextId('ms-'),
        paymentId: nextId('pay-'),
        receiptNo: newReceiptNo(new Date()),
        member: { id: 'mem2', membership: null, balance: null },
        planId: 'p_m1',
        plan: PLAN_M1,
        customDays: null,
        customPrice: null,
        startDate: cairoToday(),
        discountPct: 0,
        mode: 'FULL',
        deposit: 0,
        balanceDueDate: null,
        method: 'CASH',
        reference: null,
        settings: DEFAULT_GYM_SETTINGS,
        now: new Date(),
        ...over,
      });
      const sell = (who: AuthSpec, over: Partial<SaleInput> = {}) => h.as(who).commit(sellMembership(base(over)).ops as Op[]);
      const tamper = (over: Partial<SaleInput>, f: (ops: Op[]) => void) => {
        const ops = sellMembership(base(over)).ops as Op[];
        f(ops);
        return ops;
      };

      it('a cashier sells a month, paid in full: membership, receipt and member file move together', async () => {
        const i = base();
        await ok(h.as(CASHIER).commit(sellMembership(i).ops as Op[]));
        const m = await h.peek('members/mem2');
        expect((m?.membership as { id: string }).id).toBe(i.membershipId);
        expect(m?.balance).toBeNull();
        expect((await h.peek(`payments/${i.paymentId}`))?.amount).toBe(100000);
      });
      it('the price, the discount and the receipt cannot be changed by the browser', async () => {
        await denied(h.as(CASHIER).commit(tamper({}, (ops) => ((ops[0] as { data: Record<string, unknown> }).data.base = 1000))));
        await denied(h.as(CASHIER).commit(tamper({}, (ops) => ((ops[1] as { data: Record<string, unknown> }).data.amount = 5000))));
        // A builder that skipped the cashier limit (as a modified browser would):
        await denied(sell(CASHIER, { discountPct: 50, actorIsAdmin: true }));
        // "New member" vs "renewal" is decided from the member file, not by the browser:
        await denied(h.as(CASHIER).commit(tamper({}, (ops) => ((ops[0] as { data: Record<string, unknown> }).data.renewal = true))));
        // A sale without its receipt (cash that would never show in the day's totals):
        await denied(h.as(CASHIER).commit(tamper({}, (ops) => ops.splice(1, 1))));
        await ok(sell(CASHIER, { discountPct: 10 }));
      });
      it('an admin may give any discount', async () => {
        await ok(sell(ADMIN, { actorUid: 'admin1', actorIsAdmin: true, discountPct: 50 }));
      });
      it('a deposit must reach the minimum and leaves a balance on the member file', async () => {
        await denied(h.as(CASHIER).commit(tamper({ mode: 'DEPOSIT', deposit: 60000, balanceDueDate: cairoToday(7) }, (ops) => {
          const d = (ops[0] as { data: Record<string, unknown> }).data;
          d.paidNow = 20000;
          (ops[1] as { data: Record<string, unknown> }).data.amount = 20000;
          ((ops[2] as { data: Record<string, unknown> }).data.balance as Record<string, unknown>).remaining = 80000;
        })));
        const i = base({ mode: 'DEPOSIT', deposit: 50000, balanceDueDate: cairoToday(7) });
        await ok(h.as(CASHIER).commit(sellMembership(i).ops as Op[]));
        expect(((await h.peek('members/mem2'))?.balance as { remaining: number }).remaining).toBe(50000);
      });
      it('no deposit on a day pass; no due date beyond the limit', async () => {
        await denied(h.as(CASHIER).commit(tamper({ planId: 'p_day', plan: PLAN_DAY }, (ops) => {
          const d = (ops[0] as { data: Record<string, unknown> }).data;
          d.mode = 'DEPOSIT';
          d.paidNow = 6000;
          d.balanceDueAt = new Date(Date.now() + 5 * 86_400_000);
          (ops[1] as { data: Record<string, unknown> }).data.amount = 6000;
        })));
        await denied(h.as(CASHIER).commit(tamper({ mode: 'DEPOSIT', deposit: 50000, balanceDueDate: cairoToday(7) }, (ops) => {
          const far = new Date(Date.now() + 90 * 86_400_000);
          (ops[0] as { data: Record<string, unknown> }).data.balanceDueAt = far;
          ((ops[2] as { data: Record<string, unknown> }).data.balance as Record<string, unknown>).dueAt = far;
        })));
      });
      it('no back-dating and no stretched periods', async () => {
        // Forged consistently on the membership and the member file, as a modified browser would.
        const forge = (ops: Op[], startsAt: Date, endsAt: Date) => {
          const d = (ops[0] as { data: Record<string, unknown> }).data;
          d.startsAt = startsAt;
          d.endsAt = endsAt;
          const sum = (ops[2] as { data: Record<string, unknown> }).data.membership as Record<string, unknown>;
          sum.startsAt = startsAt;
          sum.endsAt = endsAt;
        };
        const back = DateTime.now().setZone('Africa/Cairo').startOf('day').minus({ days: 20 });
        await denied(h.as(CASHIER).commit(tamper({}, (ops) => forge(ops, back.toJSDate(), back.plus({ months: 1 }).toJSDate()))));
        await denied(h.as(CASHIER).commit(tamper({}, (ops) => {
          const d = (ops[0] as { data: Record<string, unknown> }).data;
          forge(ops, d.startsAt as Date, new Date((d.endsAt as Date).getTime() + 10 * 86_400_000));
        })));
      });
      it('an early renewal starts when the running period ends, and an unpaid balance is carried', async () => {
        const now = Date.now();
        const running: MembershipSummary = { id: 'old-ms', planNameAr: 'شهر', planNameEn: '1 month', unit: 'month', startsAt: new Date(now - 20 * 86_400_000), endsAt: new Date(now + 10 * 86_400_000), status: 'ACTIVE', visitQuota: null, visitsUsed: 0, prev: null };
        const bal: BalanceDoc = { remaining: 30000, total: 60000, dueAt: new Date(now + 3 * 86_400_000), membershipId: 'old-ms', graceUntil: null, graceReason: '' };
        await h.seed({ 'members/mem2': { ...member('mem2', 10002, 'سارة محمود', PHONE_MEM2, null, null), membership: running, balance: bal, lastPaymentId: null } });
        // Starting today, on top of the running month, is refused.
        await denied(h.as(CASHIER).commit(tamper({ member: { id: 'mem2', membership: running, balance: bal } }, (ops) => {
          const d = (ops[0] as { data: Record<string, unknown> }).data;
          const today = DateTime.now().setZone('Africa/Cairo').startOf('day');
          d.startsAt = today.toJSDate();
          d.endsAt = today.plus({ months: 1 }).toJSDate();
          const sum = (ops[2] as { data: Record<string, unknown> }).data.membership as Record<string, unknown>;
          sum.startsAt = d.startsAt;
          sum.endsAt = d.endsAt;
        })));
        // Dropping the carried balance is refused.
        await denied(h.as(CASHIER).commit(tamper({ member: { id: 'mem2', membership: running, balance: null } }, () => undefined)));
        const i = base({ member: { id: 'mem2', membership: running, balance: bal } });
        const r = sellMembership(i);
        expect(r.startsAt.getTime()).toBe(running.endsAt.getTime());
        expect(r.quote.due).toBe(130000);
        await ok(h.as(CASHIER).commit(r.ops as Op[]));
        const m = await h.peek('members/mem2');
        expect((m?.membership as { prev: unknown }).prev).toBeTruthy();
      });
      it('a coach, an accountant or a cashier without a licence cannot sell', async () => {
        await denied(sell(COACH, { actorUid: 'coach1' }));
        await h.seed({ 'license/main': { type: 'TRIAL', state: 'SUSPENDED', startsAt: new Date(Date.now() - D), endsAt: null, version: 2, note: '', updatedAt: new Date(), updatedBy: 'dev', lastAuditId: 'seed-l2' } });
        await denied(sell(CASHIER));
      });
      it('the receipt, the member file and the audit entry never pass on their own (they lean on the sale)', async () => {
        const ops = sellMembership(base()).ops as Op[];
        const only = (prefix: string) => ops.filter((o) => o.path.startsWith(prefix));
        for (const who of [COACH, MEMBER1, CASHIER]) {
          await denied(h.as(who).commit(only('payments/')));
          await denied(h.as(who).commit(only('members/')));
          await denied(h.as(who).commit([...only('payments/'), ...only('members/')]));
        }
        // a coach cannot ride a cashier's sale shape either
        await denied(h.as(COACH).commit(sellMembership(base({ actorUid: 'coach1' })).ops as Op[]));
      });
      it('a missing phone index entry cannot be filled in outside a registration', async () => {
        const w = world(Date.now());
        const idx = Object.keys(w).find((k) => k.startsWith('phoneIndex/'))!;
        const phone = idx.split('/')[1];
        const memberId = (w[idx] as { memberId: string }).memberId;
        await h.reset();
        const rest = Object.fromEntries(Object.entries(w).filter(([k]) => k !== idx));
        rest[`members/${memberId}`] = { ...rest[`members/${memberId}`], createdAt: new Date(Date.now() - D) };
        await h.seed(rest);
        await denied(h.as(CASHIER).commit([{ type: 'set', path: `phoneIndex/${phone}`, data: { memberId, createdAt: SERVER_TIME } }]));
      });
      it('a phone index entry, a counter move or an audit entry alone is refused', async () => {
        const r = registerMember({ actorUid: 'coach1', memberId: 'x-mem', auditId: 'x-aud', fullName: 'منى حسن', phone: '01014445555', codePrefix: 'PLS', counter: { next: 10004 }, phoneOwner: null });
        for (const prefix of ['phoneIndex/', 'counters/', 'auditLogs/']) {
          await denied(h.as(COACH).commit((r.ops as Op[]).filter((o) => o.path.startsWith(prefix))));
        }
        await denied(h.as(COACH).commit((r.ops as Op[]).filter((o) => !o.path.startsWith('members/'))));
      });
    });

    describe('Phase 3: balances, entry permission and refunds', () => {
      const setup = async () => {
        const msId = nextId('ms-');
        const i: SaleInput = {
          actorUid: 'cash1', actorIsAdmin: false, membershipId: msId, paymentId: nextId('pay-'), receiptNo: newReceiptNo(new Date()),
          member: { id: 'mem2', membership: null, balance: null }, planId: 'p_m1', plan: PLAN_M1, customDays: null, customPrice: null, startDate: cairoToday(),
          discountPct: 0, mode: 'DEPOSIT', deposit: 60000, balanceDueDate: cairoToday(5), method: 'CASH', reference: null, settings: DEFAULT_GYM_SETTINGS, now: new Date(),
        };
        const r = sellMembership(i);
        await h.as(CASHIER).commit(r.ops as Op[]);
        const m = (await h.peek('members/mem2')) as Record<string, unknown>;
        const toDate = (v: unknown) => (v instanceof Date ? v : (v as { toDate(): Date }).toDate());
        const b = m.balance as Record<string, unknown>;
        const balance: BalanceDoc = { remaining: b.remaining as number, total: b.total as number, dueAt: toDate(b.dueAt), membershipId: b.membershipId as string, graceUntil: null, graceReason: '' };
        const s = m.membership as Record<string, unknown>;
        const summary: MembershipSummary = { id: s.id as string, planNameAr: s.planNameAr as string, planNameEn: s.planNameEn as string, unit: 'month', startsAt: toDate(s.startsAt), endsAt: toDate(s.endsAt), status: 'ACTIVE', visitQuota: null, visitsUsed: 0, prev: null };
        return { msId, balance, summary, startsAt: r.startsAt, endsAt: r.endsAt };
      };

      it('the remainder is paid in parts, never more than what is owed', async () => {
        const { balance } = await setup();
        const pay = (amount: number) => payBalance({ actorUid: 'cash1', auditId: nextId('bp-'), paymentId: nextId('pay-'), receiptNo: newReceiptNo(new Date()), memberId: 'mem2', balance, amount, method: 'CASH', reference: null });
        const over = pay(10000) as Op[];
        (over[0] as { data: Record<string, unknown> }).data.amount = 90000;
        ((over[1] as { data: Record<string, unknown> }).data.balance as Record<string, unknown>).remaining = balance.remaining - 90000;
        await denied(h.as(CASHIER).commit(over));
        await ok(h.as(CASHIER).commit(pay(10000) as Op[]));
        expect(((await h.peek('members/mem2'))?.balance as { remaining: number }).remaining).toBe(30000);
        const rest = payBalance({ actorUid: 'cash1', auditId: nextId('bp-'), paymentId: nextId('pay-'), receiptNo: newReceiptNo(new Date()), memberId: 'mem2', balance: { ...balance, remaining: 30000 }, amount: 30000, method: 'INSTAPAY', reference: '8842' });
        await ok(h.as(CASHIER).commit(rest as Op[]));
        expect((await h.peek('members/mem2'))?.balance).toBeNull();
      });
      it('a member lists their own receipts, not anyone else\'s', async () => {
        await setup();
        await h.seed({ 'users/u-mem2': { kind: 'member', roles: ['member'], status: 'active', displayName: 'سارة', phone: PHONE_MEM2, memberId: 'mem2', inviteId: 'seed', createdAt: new Date() } });
        const MEMBER2 = { uid: 'u-mem2', email: email(2) };
        const mine = await h.as(MEMBER2).list('payments', 'memberId', 'mem2');
        expect(mine.length).toBeGreaterThan(0);
        await denied(h.as(MEMBER1).list('payments', 'memberId', 'mem2'));
      });
      it('only an admin lets a late member in, for a limited time, with a reason', async () => {
        const { balance } = await setup();
        const g = (who: string, until: string) => grantEntry({ actorUid: who, auditId: nextId('gr-'), memberId: 'mem2', balance, untilDate: until, reason: 'وعد بالسداد', now: new Date() });
        await denied(h.as(CASHIER).commit(g('cash1', cairoToday(3))));
        await ok(h.as(ADMIN).commit(g('admin1', cairoToday(3))));
        const far = g('admin1', cairoToday(3));
        ((far[0].data.balance as Record<string, unknown>).graceUntil as unknown) = new Date(Date.now() + 60 * 86_400_000);
        await denied(h.as(ADMIN).commit(far));
      });
      it('an admin cancels with a refund up to what was paid; a cashier cannot cancel', async () => {
        const { msId, balance, summary, startsAt, endsAt } = await setup();
        const c = (who: string, refund: number) =>
          cancelMembership({
            actorUid: who, auditId: nextId('cx-'), membershipId: msId,
            membership: { memberId: 'mem2', due: 100000, status: 'ACTIVE', startsAt, endsAt, plan: { price: 100000, nameAr: 'شهر', nameEn: '1 month' } },
            member: { id: 'mem2', membership: summary, balance }, refund, overridden: false, reason: 'سفر', paymentId: nextId('pay-'), receiptNo: newReceiptNo(new Date()), method: 'CASH',
          }) as Op[];
        await denied(h.as(CASHIER).commit(c('cash1', 10000)));
        const tooMuch = c('admin1', 60000);
        ((tooMuch[0] as { data: Record<string, unknown> }).data.cancel as Record<string, unknown>).refund = 90000;
        (tooMuch[3] as { data: Record<string, unknown> }).data.amount = 90000;
        await denied(h.as(ADMIN).commit(tooMuch));
        await ok(h.as(ADMIN).commit(c('admin1', 60000)));
        const m = await h.peek('members/mem2');
        expect((m?.membership as { status: string }).status).toBe('CANCELLED');
        expect(m?.balance).toBeNull();
      });
      it('old receipts and sales cannot be replayed to move a member file', async () => {
        const { msId, balance, summary } = await setup();
        const pay = (amount: number, b: BalanceDoc) => payBalance({ actorUid: 'cash1', auditId: nextId('bp-'), paymentId: nextId('pay-'), receiptNo: newReceiptNo(new Date()), memberId: 'mem2', balance: b, amount, method: 'CASH', reference: null }) as Op[];
        const first = pay(10000, balance);
        await ok(h.as(CASHIER).commit(first));
        await ok(h.as(CASHIER).commit(pay(10000, { ...balance, remaining: 30000 })));
        // re-use the first remainder receipt to lower the balance again, without paying
        const p1 = (first[0] as { path: string }).path.split('/')[1];
        await h.seed({ [`payments/${p1}`]: { ...((await h.peek(`payments/${p1}`)) as Record<string, unknown>), at: new Date(Date.now() - H) } });
        const replay = (who: AuthSpec) => {
          const ops = pay(10000, { ...balance, remaining: 20000 }).filter((o) => !o.path.startsWith('payments/'));
          (ops[0] as { data: Record<string, unknown> }).data.lastPaymentId = p1;
          return h.as(who).commit(ops);
        };
        await denied(replay(CASHIER));
        await denied(replay(COACH));
        // after a cancellation, the old sale cannot be written back onto the member file
        const ms = (await h.peek(`memberships/${msId}`)) as Record<string, unknown>;
        await h.seed({ [`memberships/${msId}`]: { ...ms, status: 'CANCELLED', createdAt: new Date(Date.now() - H) }, 'members/mem2': { ...((await h.peek('members/mem2')) as Record<string, unknown>), membership: { ...summary, status: 'CANCELLED' }, balance: null, lastPaymentId: 'other' } });
        const restore = { type: 'update' as const, path: 'members/mem2', data: { membership: { ...summary, prev: null }, balance, lastPaymentId: ms.paymentId, updatedAt: SERVER_TIME } };
        await denied(h.as(COACH).commit([restore]));
        await denied(h.as(CASHIER).commit([restore]));
      });
      it('a sale must move the member file and have exactly one receipt', async () => {
        const i = { actorUid: 'cash1', actorIsAdmin: false, membershipId: nextId('ms-'), paymentId: nextId('pay-'), receiptNo: newReceiptNo(new Date()),
          member: { id: 'mem2', membership: null, balance: null }, planId: 'p_m1', plan: PLAN_M1, customDays: null, customPrice: null, startDate: cairoToday(),
          discountPct: 0, mode: 'FULL' as const, deposit: 0, balanceDueDate: null, method: 'CASH' as const, reference: null, settings: DEFAULT_GYM_SETTINGS, now: new Date() };
        const ops = sellMembership(i).ops as Op[];
        // without the member file (where the dates are checked), e.g. a back-dated period
        const noFile = structuredClone(ops.filter((o) => !o.path.startsWith('members/')));
        (noFile[0] as { data: Record<string, unknown> }).data.startsAt = new Date(Date.now() - 40 * D);
        await denied(h.as(CASHIER).commit(noFile));
        await denied(h.as(CASHIER).commit(ops.filter((o) => !o.path.startsWith('members/'))));
        // a second receipt for the same sale (double-counted cash)
        const extra = { ...(ops[1] as { type: 'set'; path: string; data: Record<string, unknown> }), path: `payments/${nextId('pay-')}` };
        await denied(h.as(CASHIER).commit([...ops, extra]));
        await ok(h.as(CASHIER).commit(ops));
      });
      it('receipts cannot be written alone, edited or deleted', async () => {
        await denied(h.as(CASHIER).commit([{ type: 'set', path: 'payments/fake', data: { memberId: 'mem2', membershipId: null, kind: 'BALANCE', amount: 100, method: 'CASH', reference: null, receiptNo: 'R-261015-ABCDE', by: 'cash1', at: SERVER_TIME } }]));
        const { msId } = await setup();
        const ms = (await h.peek(`memberships/${msId}`)) as Record<string, unknown>;
        await denied(h.as(ADMIN).commit([{ type: 'update', path: `payments/${ms.paymentId as string}`, data: { amount: 1 } }]));
        await denied(h.as(ADMIN).commit([{ type: 'delete', path: `payments/${ms.paymentId as string}` }]));
        await denied(h.as(ADMIN).commit([{ type: 'update', path: `memberships/${msId}`, data: { due: 1 } }]));
      });
    });

    describe('wiping member data (developer, fresh code + phrase)', () => {
      const memberDeletes = () =>
        wipeDeletes({
          members: [
            { id: 'mem1', phoneE164: PHONE_MEM1 },
            { id: 'mem2', phoneE164: PHONE_MEM2 },
          ],
          memberUserUids: ['u-mem1'],
          memberInviteIds: [],
        });
      it('the developer wipes members, their sign-ins and the counter; staff stay', async () => {
        await ok(h.as(DEV).commit(wipeRecord({ actorUid: 'dev', auditId: 'w-a1', wipeId: 'w1', counts: { members: 3, accounts: 2, invites: 0 } })));
        const ops = memberDeletes();
        for (let i = 0; i < ops.length; i += 8) await ok(h.as(DEV).commit(ops.slice(i, i + 8)));
        expect(await h.peek('members/mem1')).toBeUndefined();
        expect(await h.peek('users/u-mem1')).toBeUndefined();
        expect(await h.peek('loginAliases/m+201011111111')).toBeUndefined();
        expect(await h.peek('counters/members')).toBeUndefined();
        expect(await h.peek('users/cash1')).toBeTruthy();
        expect(await h.peek('loginAliases/s+201511111111')).toBeTruthy();
      });
      it('staff profiles and staff aliases can never be wiped', async () => {
        await denied(h.as(DEV).commit([{ type: 'delete', path: 'users/cash1' }]));
        await denied(h.as(DEV).commit([{ type: 'delete', path: 'loginAliases/s+201511111111' }]));
        await denied(h.as(DEV).commit([{ type: 'delete', path: 'auditLogs/seed-a' }]));
      });
      it('an admin, a cashier, or a developer without a recent check cannot wipe', async () => {
        for (const who of [ADMIN, CASHIER]) {
          await denied(h.as(who).commit([{ type: 'delete', path: 'members/mem2' }]));
          await denied(h.as(who).commit(wipeRecord({ actorUid: who.uid, auditId: 'w-x' + who.uid, wipeId: 'wx' + who.uid, counts: { members: 1, accounts: 0, invites: 0 } })));
        }
        await denied(h.as(DEV_NO_MFA).commit([{ type: 'delete', path: 'members/mem2' }]));
        await h.seed({ 'staffSessions/dev': { authTime: SIGNED_IN_AT, device: 'test', at: new Date(Date.now() - 3600_000) } });
        await denied(h.as(DEV).commit([{ type: 'delete', path: 'members/mem2' }]));
      });
    });

    describe('one person, several jobs', () => {
      it('an admin adds a job to an existing cashier account; never to an admin account', async () => {
        const target = { uid: 'cash1', kind: 'staff' as const, roles: ['cashier'], status: 'active' as const };
        await ok(h.as(ADMIN).commit(updateStaff({ actorUid: 'admin1', actorRoles: ['admin'], auditId: 'mj-1', target, roles: ['cashier', 'coach'] })));
        expect((await h.peek('users/cash1'))?.roles).toEqual(['cashier', 'coach']);
        await denied(h.as(ADMIN).commit([
          { type: 'update', path: 'users/admin2', data: { roles: ['admin', 'coach'], updatedAt: SERVER_TIME, lastAuditId: 'mj-2' } },
          { type: 'set', path: 'auditLogs/mj-2', data: { actorUid: 'admin1', action: 'staff.update', entityType: 'users', entityId: 'admin2', at: SERVER_TIME, summary: {} } },
        ]));
      });
    });

    describe('audit log cannot be forged or edited', () => {
      it('standalone entries, edits and deletes are refused', async () => {
        await denied(h.as(CASHIER).commit([{ type: 'set', path: 'auditLogs/fake', data: { actorUid: 'cash1', action: 'member.register', entityType: 'members', entityId: 'mem1', at: SERVER_TIME, summary: {} } }]));
        await denied(h.as(ADMIN).commit([{ type: 'update', path: 'auditLogs/seed-a', data: { action: 'nothing' } }]));
        await denied(h.as(ADMIN).commit([{ type: 'delete', path: 'auditLogs/seed-a' }]));
      });
    });

    describe('later-phase collections stay closed to browsers', () => {
      it('no one writes memberships, payments or check-ins yet', async () => {
        for (const p of ['memberships/x', 'payments/x', 'checkins/x', 'financeEntries/x', 'plans/x', 'gymSettings/main']) {
          await denied(h.as(ADMIN).commit([{ type: 'set', path: p, data: { a: 1 } }]));
        }
      });
    });
  });
}
