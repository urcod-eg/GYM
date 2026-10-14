import { describe, expect, it } from 'vitest';
import { aliasId, inviteIdOf, inviteUrl, isInviteCode, isLoginEmail, newInviteCode, newLoginEmail, passwordProblem, rolesInviterMayGrant } from './identity';
import { activeBlocks, liftMemberBlock, memberInvite, redeemInvite, registerMember, SERVER_TIME, setBranding, setLicense, setMemberBlock, staffInvite, updateStaff, WriteError, type InviteDoc } from './writes';

const NOW = new Date('2026-10-14T10:00:00Z');
const reason = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    if (e instanceof WriteError) return e.reason;
    throw e;
  }
  return 'ok';
};

describe('identity', () => {
  it('builds alias ids per kind and refuses raw phones', () => {
    expect(aliasId('member', '+201012345678')).toBe('m+201012345678');
    expect(aliasId('staff', '+201512345678')).toBe('s+201512345678');
    expect(() => aliasId('member', '01012345678')).toThrow();
  });
  it('makes random internal e-mails and invite codes', () => {
    const a = newLoginEmail('member');
    expect(isLoginEmail(a)).toBe(true);
    expect(a).not.toBe(newLoginEmail('member'));
    expect(newLoginEmail('staff').startsWith('s-')).toBe(true);
    expect(isLoginEmail('someone@gmail.com')).toBe(false);
    const c = newInviteCode();
    expect(isInviteCode(c)).toBe(true);
    expect(c).not.toBe(newInviteCode());
  });
  it('hashes codes to a stable 64-char hex id', async () => {
    const id = await inviteIdOf('abc');
    expect(id).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
  it('puts the code after the hash route', () => {
    expect(inviteUrl('https://g.web.app/', 'X')).toBe('https://g.web.app/#/activate?c=X');
    expect(inviteUrl('https://g.web.app/#/cashier', 'X')).toBe('https://g.web.app/#/activate?c=X');
  });
  it('password rule', () => {
    expect(passwordProblem('abc12')).toBe('short');
    expect(passwordProblem('abcdefgh')).toBe('letter-digit');
    expect(passwordProblem('12345678')).toBe('letter-digit');
    expect(passwordProblem('gym2026ok')).toBeNull();
    expect(passwordProblem('جيم12345')).toBeNull();
  });
  it('only the developer may grant admin', () => {
    expect(rolesInviterMayGrant(['developer'])).toContain('admin');
    expect(rolesInviterMayGrant(['admin'])).not.toContain('admin');
    expect(rolesInviterMayGrant(['cashier'])).toEqual([]);
  });
});

describe('registerMember', () => {
  const base = { actorUid: 'cashier1', memberId: 'mem1', auditId: 'aud1', fullName: '  أحمد   علي ', phone: '0101 234 5678', codePrefix: 'PLS', counter: { next: 10007 }, phoneOwner: null };
  it('numbers from the counter and writes the four documents', () => {
    const r = registerMember(base);
    expect(r.memberCode).toBe('PLS-10007');
    expect(r.ops.map((o) => o.path)).toEqual(['counters/members', 'phoneIndex/+201012345678', 'members/mem1', 'auditLogs/aud1']);
    expect(r.ops[0].data).toEqual({ next: 10008, lastMemberId: 'mem1', updatedAt: SERVER_TIME });
    const m = r.ops[2].data;
    expect(m.fullName).toBe('أحمد علي');
    expect(m.accountStatus).toBe('PENDING_ACTIVATION');
    expect(m.authUid).toBeNull();
    expect(m.lastAuditId).toBe('aud1');
    expect(r.ops[3].data).toMatchObject({ actorUid: 'cashier1', action: 'member.register', entityType: 'members', entityId: 'mem1', at: SERVER_TIME });
  });
  it('starts at 10001 with the default prefix', () => {
    expect(registerMember({ ...base, counter: null, codePrefix: null }).memberCode).toBe('GYM-10001');
  });
  it('refuses duplicates and bad input', () => {
    expect(reason(() => registerMember({ ...base, phoneOwner: 'other' }))).toBe('phone-registered');
    expect(reason(() => registerMember({ ...base, phone: '0123' }))).toBe('invalid-phone');
    expect(reason(() => registerMember({ ...base, fullName: 'a' }))).toBe('invalid-name');
  });
});

describe('invites', () => {
  const member = { id: 'mem1', fullName: 'أحمد', phoneE164: '+201012345678', authUid: null as string | null };
  it('cashier activates a new member; link expires in 24h', () => {
    const [op] = memberInvite({ actorUid: 'c1', actorRoles: ['cashier'], inviteId: 'h1', member, purpose: 'activate', now: NOW });
    expect(op.path).toBe('invites/h1');
    expect(op.data).toMatchObject({ kind: 'member', aliasId: 'm+201012345678', roles: ['member'], prevUid: null, usedAt: null, usedBy: null });
    expect((op.data.expiresAt as Date).toISOString()).toBe('2026-10-15T10:00:00.000Z');
  });
  it('resets need admin and an identity check', () => {
    const active = { ...member, authUid: 'u-old' };
    expect(reason(() => memberInvite({ actorUid: 'c1', actorRoles: ['cashier'], inviteId: 'h', member: active, purpose: 'reset', identityCheck: 'IN_PERSON', now: NOW }))).toBe('permission-denied');
    expect(reason(() => memberInvite({ actorUid: 'a1', actorRoles: ['admin'], inviteId: 'h', member: active, purpose: 'reset', now: NOW }))).toBe('identity-check-required');
    expect(reason(() => memberInvite({ actorUid: 'a1', actorRoles: ['admin'], inviteId: 'h', member: active, purpose: 'activate', now: NOW }))).toBe('already-active');
    const [op] = memberInvite({ actorUid: 'a1', actorRoles: ['admin'], inviteId: 'h', member: active, purpose: 'reset', identityCheck: 'IN_PERSON', now: NOW });
    expect(op.data.prevUid).toBe('u-old');
  });
  it('coaches cannot invite', () => {
    expect(reason(() => memberInvite({ actorUid: 'x', actorRoles: ['coach'], inviteId: 'h', member, purpose: 'activate', now: NOW }))).toBe('permission-denied');
  });
  it('staff invites: admin cannot create admins, phone must be free', () => {
    const base = { actorUid: 'a1', actorRoles: ['admin'], inviteId: 'h2', phone: '01512345678', displayName: 'منى', roles: ['cashier'], purpose: 'activate' as const, aliasOwner: null, now: NOW };
    expect(staffInvite(base)[0].data).toMatchObject({ kind: 'staff', aliasId: 's+201512345678', roles: ['cashier'], memberId: null });
    expect(reason(() => staffInvite({ ...base, roles: ['admin'] }))).toBe('permission-denied');
    expect(reason(() => staffInvite({ ...base, aliasOwner: 'u9' }))).toBe('phone-registered');
    expect(staffInvite({ ...base, actorRoles: ['developer'], roles: ['admin'] })[0].data.roles).toEqual(['admin']);
  });
  it('staff reset keeps the same roles and replaces the active account', () => {
    const target = { uid: 'u9', roles: ['cashier'], status: 'active', kind: 'staff' };
    const base = { actorUid: 'a1', actorRoles: ['admin'], inviteId: 'h3', phone: '01512345678', displayName: 'منى', roles: ['cashier'], purpose: 'reset' as const, target, aliasOwner: 'u9', now: NOW };
    expect(staffInvite(base)[0].data.prevUid).toBe('u9');
    expect(reason(() => staffInvite({ ...base, roles: ['coach'] }))).toBe('invalid-input');
    expect(reason(() => staffInvite({ ...base, target: { ...target, status: 'disabled' } }))).toBe('not-found');
    expect(reason(() => staffInvite({ ...base, target: { ...target, roles: ['admin'] }, roles: ['admin'] }))).toBe('permission-denied');
  });
});

describe('redeemInvite', () => {
  const inv: InviteDoc = { kind: 'member', purpose: 'activate', aliasId: 'm+201012345678', phone: '+201012345678', displayName: 'أحمد', roles: ['member'], memberId: 'mem1', prevUid: null, identityCheck: null, createdBy: 'c1', createdAt: null, expiresAt: new Date('2026-10-15T09:00:00Z'), usedAt: null, usedBy: null };
  const email = 'm-0123456789abcdef01234567@login.urcod.invalid';
  it('activation: invite, profile, alias, member link', () => {
    const ops = redeemInvite({ uid: 'u1', email, inviteId: 'h1', invite: inv, now: NOW });
    expect(ops.map((o) => `${o.type} ${o.path}`)).toEqual(['update invites/h1', 'set users/u1', 'set loginAliases/m+201012345678', 'update members/mem1']);
    expect(ops[1].data).toMatchObject({ kind: 'member', roles: ['member'], status: 'active', memberId: 'mem1', inviteId: 'h1' });
    expect(ops[2].data).toMatchObject({ email, uid: 'u1', inviteId: 'h1' });
  });
  it('reset also retires the previous account', () => {
    const ops = redeemInvite({ uid: 'u2', email, inviteId: 'h2', invite: { ...inv, purpose: 'reset', prevUid: 'u1' }, now: NOW });
    expect(ops.at(-1)).toEqual({ type: 'update', path: 'users/u1', data: { status: 'replaced', replacedBy: 'u2', updatedAt: SERVER_TIME } });
  });
  it('staff invite has no member link', () => {
    const ops = redeemInvite({ uid: 'u3', email, inviteId: 'h3', invite: { ...inv, kind: 'staff', roles: ['cashier'], memberId: null, aliasId: 's+201012345678' }, now: NOW });
    expect(ops.map((o) => o.path)).toEqual(['invites/h3', 'users/u3', 'loginAliases/s+201012345678']);
  });
  it('refuses used, expired, or foreign e-mails', () => {
    expect(reason(() => redeemInvite({ uid: 'u1', email, inviteId: 'h', invite: { ...inv, usedBy: 'x' }, now: NOW }))).toBe('token-used');
    expect(reason(() => redeemInvite({ uid: 'u1', email, inviteId: 'h', invite: inv, now: new Date('2026-10-16T00:00:00Z') }))).toBe('token-expired');
    expect(reason(() => redeemInvite({ uid: 'u1', email: 'a@b.com', inviteId: 'h', invite: inv, now: NOW }))).toBe('invalid-input');
  });
});

describe('staff, blocks, licence, branding', () => {
  it('admin edits a cashier but not an admin or themselves', () => {
    const target = { uid: 'u9', roles: ['cashier'], status: 'active', kind: 'staff' };
    const ops = updateStaff({ actorUid: 'a1', actorRoles: ['admin'], auditId: 'au', target, status: 'disabled' });
    expect(ops[0].data).toEqual({ status: 'disabled', updatedAt: SERVER_TIME, lastAuditId: 'au' });
    expect(reason(() => updateStaff({ actorUid: 'a1', actorRoles: ['admin'], auditId: 'au', target: { ...target, roles: ['admin'] }, status: 'disabled' }))).toBe('permission-denied');
    expect(reason(() => updateStaff({ actorUid: 'u9', actorRoles: ['admin'], auditId: 'au', target, status: 'disabled' }))).toBe('cannot-change-self');
    expect(reason(() => updateStaff({ actorUid: 'a1', actorRoles: ['admin'], auditId: 'au', target, roles: ['admin'] }))).toBe('permission-denied');
  });
  it('blocks are added and lifted as whole maps with an audit entry', () => {
    const add = setMemberBlock({ actorUid: 'a1', auditId: 'x1', memberId: 'mem1', blocks: {}, scope: 'CHECKIN_BLOCK', reasonCode: 'MISCONDUCT', note: ' late ', until: null, now: NOW });
    expect(add[0].data.blocks).toEqual({ CHECKIN_BLOCK: { reasonCode: 'MISCONDUCT', note: 'late', until: null, by: 'a1', at: SERVER_TIME } });
    const existing = { CHECKIN_BLOCK: { reasonCode: 'X', note: '', until: null, by: 'a1', at: NOW } };
    const lift = liftMemberBlock({ actorUid: 'a1', auditId: 'x2', memberId: 'mem1', blocks: existing, scope: 'CHECKIN_BLOCK', note: 'ok' });
    expect(lift[0].data.blocks).toEqual({});
    expect(reason(() => liftMemberBlock({ actorUid: 'a1', auditId: 'x2', memberId: 'mem1', blocks: {}, scope: 'LOGIN_BLOCK', note: '' }))).toBe('not-found');
  });
  it('expired temporary blocks no longer count', () => {
    expect(activeBlocks({ A: { until: new Date('2026-10-13') }, B: { until: null }, C: {} }, NOW)).toEqual(['B', 'C']);
  });
  it('licence versions increase and lifetime has no end', () => {
    const t = setLicense({ actorUid: 'd', auditId: 'l1', prevVersion: null, type: 'TRIAL', state: 'ACTIVE', startsAt: NOW, days: 14, note: '' });
    expect(t[0].data).toMatchObject({ version: 1, endsAt: new Date('2026-10-28T10:00:00Z') });
    const l = setLicense({ actorUid: 'd', auditId: 'l2', prevVersion: 1, type: 'LIFETIME', state: 'ACTIVE', startsAt: NOW, days: null, note: '' });
    expect(l[0].data).toMatchObject({ version: 2, endsAt: null });
    expect(reason(() => setLicense({ actorUid: 'd', auditId: 'l', prevVersion: 1, type: 'TRIAL', state: 'ACTIVE', startsAt: NOW, days: 90, note: '' }))).toBe('invalid-days');
  });
  it('branding validates prefix, colour and logo size', () => {
    const ok = { actorUid: 'd', auditId: 'b', nameAr: 'بلس جيم', nameEn: 'PULSE GYM', codePrefix: 'PLS', primaryColor: '#e51c35', supportPhone: '01012345678', logoDataUrl: null };
    expect(setBranding(ok)[0].data).toMatchObject({ primaryColor: '#E51C35', supportPhone: '+201012345678' });
    expect(reason(() => setBranding({ ...ok, codePrefix: 'pls' }))).toBe('invalid-input');
    expect(reason(() => setBranding({ ...ok, logoDataUrl: 'data:image/svg+xml;base64,AAAA' }))).toBe('invalid-logo');
  });
});
