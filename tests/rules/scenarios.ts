/**
 * Security scenarios for firestore.rules, written once and run twice:
 *   - tests/rules-sim/rules.sim.test.ts  → the in-repo simulator (runs anywhere: `npm test`)
 *   - tests/rules/firestore.rules.test.ts → the official Firestore emulator (`npm run test:rules`, Java 21, CI)
 * Every allowed write here is produced by the same builders the app uses (src/domain/writes.ts).
 */
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
  type InviteDoc,
  type WriteOp,
} from '../../src/domain/writes';

export interface AuthSpec {
  uid: string;
  email?: string;
  mfa?: boolean;
}
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

function world(now: number): Record<string, Data> {
  return {
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
  };
}

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

  const DEV = { uid: 'dev', email: 'dev@urcod.example', mfa: true };
  const DEV_NO_MFA = { uid: 'dev', email: 'dev@urcod.example' };
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
        await ok(h.as(S).get('members/mem1'));
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

    describe('audit log cannot be forged or edited', () => {
      it('standalone entries, edits and deletes are refused', async () => {
        await denied(h.as(CASHIER).commit([{ type: 'set', path: 'auditLogs/fake', data: { actorUid: 'cash1', action: 'member.register', entityType: 'members', entityId: 'mem1', at: SERVER_TIME, summary: {} } }]));
        await denied(h.as(ADMIN).commit([{ type: 'update', path: 'auditLogs/seed-a', data: { action: 'nothing' } }]));
        await denied(h.as(ADMIN).commit([{ type: 'delete', path: 'auditLogs/seed-a' }]));
      });
    });

    describe('later-phase collections stay closed to browsers', () => {
      it('no one writes memberships, payments or check-ins yet', async () => {
        for (const p of ['memberships/x', 'payments/x', 'checkins/x', 'financeEntries/x', 'plans/x']) {
          await denied(h.as(ADMIN).commit([{ type: 'set', path: p, data: { a: 1 } }]));
        }
      });
    });
  });
}
