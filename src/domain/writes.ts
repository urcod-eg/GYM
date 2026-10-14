/**
 * Write sets: every change the app makes to Firestore is built here as a plain list of
 * operations, then committed atomically (batch or transaction) by src/firebase/commit.ts.
 *
 * Why one place: on the free plan there is no server code, so the security rules are the only
 * guard. Each builder below produces exactly the shape the rules accept, the unit tests pin those
 * shapes, and the rules tests (tests/rules) commit the very same write sets against the emulator.
 * If a builder and the rules disagree, a test fails before anything ships.
 *
 * Builders are pure: no Firebase imports, no clock reads (callers pass `now`), no randomness
 * (callers pass ids). `SERVER_TIME` becomes Firestore's serverTimestamp(), which is what the rules
 * compare with `request.time`.
 */
import { buildSearchTokens, normalizeEgyptPhone } from './text';
import { aliasId, isLoginEmail, rolesInviterMayGrant, STAFF_ROLES, type PersonKind, type StaffRole } from './identity';

export const SERVER_TIME = Object.freeze({ $serverTime: true as const });
export type ServerTime = typeof SERVER_TIME;
export type Value = string | number | boolean | null | Date | ServerTime | Value[] | { [k: string]: Value };
export type DocData = { [k: string]: Value };
export type WriteOp = { type: 'set' | 'update'; path: string; data: DocData };

/** A refusal the UI can translate (`err.<reason>` in the string tables). */
export class WriteError extends Error {
  constructor(public reason: string) {
    super(reason);
  }
}
const refuse = (reason: string): never => {
  throw new WriteError(reason);
};

export const INVITE_TTL_HOURS = 24;
export const FIRST_MEMBER_NO = 10001;
export const DEFAULT_CODE_PREFIX = 'GYM';
export const IDENTITY_CHECKS = ['IN_PERSON', 'PHONE_CALL'] as const;
export const BLOCK_SCOPES = ['LOGIN_BLOCK', 'TEMPORARY_SUSPENSION', 'CHECKIN_BLOCK', 'PAID_FEATURES_BLOCK'] as const;
export type BlockScope = (typeof BLOCK_SCOPES)[number];
export const LICENSE_TYPES = ['TRIAL', 'FIXED', 'LIFETIME'] as const;
export type LicenseType = (typeof LICENSE_TYPES)[number];

function audit(auditId: string, actorUid: string, action: string, entityType: 'members' | 'users' | 'license' | 'gymPublicConfig', entityId: string, summary: DocData): WriteOp {
  return { type: 'set', path: `auditLogs/${auditId}`, data: { actorUid, action, entityType, entityId, at: SERVER_TIME, summary } };
}

const cleanName = (s: string) => s.replace(/\s+/g, ' ').trim();

// ---------------------------------------------------------------- members

export interface RegisterInput {
  actorUid: string;
  memberId: string;
  auditId: string;
  fullName: string;
  phone: string;
  assignedCoachId?: string | null;
  /** From gymPublicConfig/main; null when the developer has not saved branding yet. */
  codePrefix: string | null;
  /** counters/members as read inside the transaction. */
  counter: { next: number } | null;
  /** phoneIndex/{phone} as read inside the transaction (the member id it points to). */
  phoneOwner: string | null;
}

export function registerMember(i: RegisterInput): { ops: WriteOp[]; memberNo: number; memberCode: string; phoneE164: string } {
  const fullName = cleanName(i.fullName);
  if (fullName.length < 2 || fullName.length > 80) refuse('invalid-name');
  const phoneE164 = normalizeEgyptPhone(i.phone) ?? refuse('invalid-phone');
  if (i.phoneOwner) refuse('phone-registered');
  const memberNo = i.counter ? i.counter.next : FIRST_MEMBER_NO;
  const memberCode = `${i.codePrefix ?? DEFAULT_CODE_PREFIX}-${memberNo}`;
  const ops: WriteOp[] = [
    { type: 'set', path: 'counters/members', data: { next: memberNo + 1, lastMemberId: i.memberId, updatedAt: SERVER_TIME } },
    { type: 'set', path: `phoneIndex/${phoneE164}`, data: { memberId: i.memberId, createdAt: SERVER_TIME } },
    {
      type: 'set',
      path: `members/${i.memberId}`,
      data: {
        memberNo,
        memberCode,
        fullName,
        phoneE164,
        authUid: null,
        accountStatus: 'PENDING_ACTIVATION',
        assignedCoachId: i.assignedCoachId ?? null,
        vipTierId: null,
        blocks: {},
        searchTokens: buildSearchTokens(fullName, phoneE164, memberCode),
        lastInviteId: null,
        createdAt: SERVER_TIME,
        createdBy: i.actorUid,
        updatedAt: SERVER_TIME,
        lastAuditId: i.auditId,
      },
    },
    audit(i.auditId, i.actorUid, 'member.register', 'members', i.memberId, { memberCode, fullName }),
  ];
  return { ops, memberNo, memberCode, phoneE164 };
}

export interface BlockEntry {
  reasonCode: string;
  note: string;
  until: Date | null;
  by: string;
  at: Date;
}

export function setMemberBlock(i: { actorUid: string; auditId: string; memberId: string; blocks: Record<string, BlockEntry>; scope: BlockScope; reasonCode: string; note: string; until: Date | null; now: Date }): WriteOp[] {
  if (!BLOCK_SCOPES.includes(i.scope)) refuse('invalid-input');
  if (!/^[A-Z_]{2,30}$/.test(i.reasonCode)) refuse('invalid-input');
  const note = i.note.trim();
  if (note.length > 300) refuse('invalid-input');
  if (i.until && i.until <= i.now) refuse('invalid-input');
  const blocks: DocData = {};
  for (const [k, v] of Object.entries(i.blocks)) blocks[k] = { ...v };
  blocks[i.scope] = { reasonCode: i.reasonCode, note, until: i.until, by: i.actorUid, at: SERVER_TIME };
  return [
    { type: 'update', path: `members/${i.memberId}`, data: { blocks, updatedAt: SERVER_TIME, lastAuditId: i.auditId } },
    audit(i.auditId, i.actorUid, 'member.block', 'members', i.memberId, { scope: i.scope, reasonCode: i.reasonCode }),
  ];
}

export function liftMemberBlock(i: { actorUid: string; auditId: string; memberId: string; blocks: Record<string, BlockEntry>; scope: BlockScope; note: string }): WriteOp[] {
  if (!(i.scope in i.blocks)) refuse('not-found');
  const blocks: DocData = {};
  for (const [k, v] of Object.entries(i.blocks)) if (k !== i.scope) blocks[k] = { ...v };
  return [
    { type: 'update', path: `members/${i.memberId}`, data: { blocks, updatedAt: SERVER_TIME, lastAuditId: i.auditId } },
    audit(i.auditId, i.actorUid, 'member.unblock', 'members', i.memberId, { scope: i.scope, note: i.note.trim().slice(0, 300) }),
  ];
}

// ---------------------------------------------------------------- invites

export interface InviteDoc {
  kind: PersonKind;
  purpose: 'activate' | 'reset';
  aliasId: string;
  phone: string;
  displayName: string;
  roles: string[];
  memberId: string | null;
  prevUid: string | null;
  identityCheck: string | null;
  createdBy: string;
  createdAt: unknown;
  expiresAt: Date;
  usedAt: unknown;
  usedBy: string | null;
}

const expiry = (now: Date) => new Date(now.getTime() + INVITE_TTL_HOURS * 3600_000);

/** Activation (new member) or password reset (existing member). Resets need an identity check. */
export function memberInvite(i: {
  actorUid: string;
  actorRoles: readonly string[];
  inviteId: string;
  member: { id: string; fullName: string; phoneE164: string; authUid: string | null };
  purpose: 'activate' | 'reset';
  identityCheck?: string | null;
  now: Date;
}): WriteOp[] {
  const front = i.actorRoles.some((r) => r === 'admin' || r === 'cashier' || r === 'developer');
  if (!front) refuse('permission-denied');
  if (i.purpose === 'activate' && i.member.authUid) refuse('already-active');
  if (i.purpose === 'reset') {
    if (!i.member.authUid) refuse('not-activated');
    if (!i.actorRoles.some((r) => r === 'admin' || r === 'developer')) refuse('permission-denied');
    if (!IDENTITY_CHECKS.includes(i.identityCheck as (typeof IDENTITY_CHECKS)[number])) refuse('identity-check-required');
  }
  const data: DocData = {
    kind: 'member',
    purpose: i.purpose,
    aliasId: aliasId('member', i.member.phoneE164),
    phone: i.member.phoneE164,
    displayName: i.member.fullName,
    roles: ['member'],
    memberId: i.member.id,
    prevUid: i.purpose === 'reset' ? i.member.authUid : null,
    identityCheck: i.purpose === 'reset' ? (i.identityCheck as string) : null,
    createdBy: i.actorUid,
    createdAt: SERVER_TIME,
    expiresAt: expiry(i.now),
    usedAt: null,
    usedBy: null,
  };
  return [{ type: 'set', path: `invites/${i.inviteId}`, data }];
}

/** New staff account, or a new password for an existing one (`prevUid` = the account being replaced). */
export function staffInvite(i: {
  actorUid: string;
  actorRoles: readonly string[];
  inviteId: string;
  phone: string;
  displayName: string;
  roles: string[];
  purpose: 'activate' | 'reset';
  /** For a reset: the staff account being replaced, as read from users/{uid}. */
  target?: { uid: string; roles: string[]; status: string; kind: string } | null;
  /** loginAliases/s+phone as read before writing (its uid), or null when free. */
  aliasOwner: string | null;
  now: Date;
}): WriteOp[] {
  const phone = normalizeEgyptPhone(i.phone) ?? refuse('invalid-phone');
  const displayName = cleanName(i.displayName);
  if (displayName.length < 2 || displayName.length > 80) refuse('invalid-name');
  const allowed = rolesInviterMayGrant(i.actorRoles);
  const roles = [...new Set(i.roles)].sort();
  if (roles.length === 0 || !roles.every((r) => (STAFF_ROLES as readonly string[]).includes(r))) refuse('invalid-input');
  if (!roles.every((r) => allowed.includes(r as StaffRole))) refuse('permission-denied');
  let prevUid: string | null = null;
  if (i.purpose === 'activate') {
    if (i.aliasOwner) refuse('phone-registered');
  } else {
    const t = i.target ?? refuse('not-found');
    if (t.kind !== 'staff' || t.status !== 'active') refuse('not-found');
    if (i.aliasOwner !== t.uid) refuse('not-found');
    if (JSON.stringify([...t.roles].sort()) !== JSON.stringify(roles)) refuse('invalid-input');
    if (!t.roles.every((r) => allowed.includes(r as StaffRole))) refuse('permission-denied');
    prevUid = t.uid;
  }
  const data: DocData = {
    kind: 'staff',
    purpose: i.purpose,
    aliasId: aliasId('staff', phone),
    phone,
    displayName,
    roles,
    memberId: null,
    prevUid,
    identityCheck: null,
    createdBy: i.actorUid,
    createdAt: SERVER_TIME,
    expiresAt: expiry(i.now),
    usedAt: null,
    usedBy: null,
  };
  return [{ type: 'set', path: `invites/${i.inviteId}`, data }];
}

/**
 * Run by the invitee right after Firebase created their new account (they are signed in as `uid`).
 * One atomic batch: marks the invite used, creates their profile, points their phone at the new
 * account, links the member file, and retires the previous account on a reset.
 */
export function redeemInvite(i: { uid: string; email: string; inviteId: string; invite: InviteDoc; now: Date }): WriteOp[] {
  const inv = i.invite;
  if (inv.usedBy || inv.usedAt) refuse('token-used');
  if (!(inv.expiresAt instanceof Date) || inv.expiresAt <= i.now) refuse('token-expired');
  if (!isLoginEmail(i.email)) refuse('invalid-input');
  const ops: WriteOp[] = [
    { type: 'update', path: `invites/${i.inviteId}`, data: { usedAt: SERVER_TIME, usedBy: i.uid } },
    {
      type: 'set',
      path: `users/${i.uid}`,
      data: { kind: inv.kind, roles: [...inv.roles], status: 'active', displayName: inv.displayName, phone: inv.phone, memberId: inv.memberId, inviteId: i.inviteId, createdAt: SERVER_TIME },
    },
    { type: 'set', path: `loginAliases/${inv.aliasId}`, data: { email: i.email, uid: i.uid, inviteId: i.inviteId, at: SERVER_TIME } },
  ];
  if (inv.kind === 'member' && inv.memberId) {
    ops.push({ type: 'update', path: `members/${inv.memberId}`, data: { authUid: i.uid, accountStatus: 'ACTIVE', lastInviteId: i.inviteId, updatedAt: SERVER_TIME } });
  }
  if (inv.prevUid) {
    ops.push({ type: 'update', path: `users/${inv.prevUid}`, data: { status: 'replaced', replacedBy: i.uid, updatedAt: SERVER_TIME } });
  }
  return ops;
}

// ---------------------------------------------------------------- staff

export function updateStaff(i: {
  actorUid: string;
  actorRoles: readonly string[];
  auditId: string;
  target: { uid: string; roles: string[]; status: string; kind: string };
  roles?: string[];
  status?: 'active' | 'disabled';
}): WriteOp[] {
  if (i.target.uid === i.actorUid) refuse('cannot-change-self');
  if (i.target.kind !== 'staff' || i.target.status === 'replaced') refuse('not-found');
  const allowed = rolesInviterMayGrant(i.actorRoles);
  if (!i.target.roles.every((r) => allowed.includes(r as StaffRole))) refuse('permission-denied');
  const data: DocData = { updatedAt: SERVER_TIME, lastAuditId: i.auditId };
  const summary: DocData = {};
  if (i.roles) {
    const roles = [...new Set(i.roles)].sort();
    if (roles.length === 0 || !roles.every((r) => allowed.includes(r as StaffRole))) refuse('permission-denied');
    data.roles = roles;
    summary.roles = roles;
  }
  if (i.status) {
    data.status = i.status;
    summary.status = i.status;
  }
  if (!i.roles && !i.status) refuse('invalid-input');
  return [{ type: 'update', path: `users/${i.target.uid}`, data }, audit(i.auditId, i.actorUid, 'staff.update', 'users', i.target.uid, summary)];
}

// ---------------------------------------------------------------- developer

export function setLicense(i: { actorUid: string; auditId: string; prevVersion: number | null; type: LicenseType; state: 'ACTIVE' | 'SUSPENDED'; startsAt: Date; days: number | null; note: string }): WriteOp[] {
  if (!LICENSE_TYPES.includes(i.type)) refuse('invalid-input');
  let endsAt: Date | null = null;
  if (i.type !== 'LIFETIME') {
    const max = i.type === 'TRIAL' ? 60 : 3650;
    if (!Number.isInteger(i.days) || (i.days as number) < 1 || (i.days as number) > max) refuse('invalid-days');
    endsAt = new Date(i.startsAt.getTime() + (i.days as number) * 86_400_000);
  }
  const version = (i.prevVersion ?? 0) + 1;
  return [
    { type: 'set', path: 'license/main', data: { type: i.type, state: i.state, startsAt: i.startsAt, endsAt, version, note: i.note.trim().slice(0, 200), updatedAt: SERVER_TIME, updatedBy: i.actorUid, lastAuditId: i.auditId } },
    audit(i.auditId, i.actorUid, 'license.set', 'license', 'main', { type: i.type, state: i.state, version }),
  ];
}

export const LOGO_MAX_CHARS = 200_000;

export function setBranding(i: { actorUid: string; auditId: string; nameAr: string; nameEn: string; codePrefix: string; primaryColor: string; supportPhone: string; logoDataUrl: string | null }): WriteOp[] {
  const nameAr = cleanName(i.nameAr);
  const nameEn = cleanName(i.nameEn);
  if (nameAr.length < 2 || nameAr.length > 60 || nameEn.length < 2 || nameEn.length > 60) refuse('invalid-name');
  if (!/^[A-Z]{2,5}$/.test(i.codePrefix)) refuse('invalid-input');
  if (!/^#[0-9A-Fa-f]{6}$/.test(i.primaryColor)) refuse('invalid-input');
  const supportPhone = normalizeEgyptPhone(i.supportPhone) ?? refuse('invalid-phone');
  if (i.logoDataUrl !== null && (!/^data:image\/(png|webp|jpeg);base64,[A-Za-z0-9+/=]+$/.test(i.logoDataUrl) || i.logoDataUrl.length > LOGO_MAX_CHARS)) refuse('invalid-logo');
  return [
    { type: 'set', path: 'gymPublicConfig/main', data: { nameAr, nameEn, codePrefix: i.codePrefix, primaryColor: i.primaryColor.toUpperCase(), supportPhone, logoDataUrl: i.logoDataUrl, updatedAt: SERVER_TIME, updatedBy: i.actorUid, lastAuditId: i.auditId } },
    audit(i.auditId, i.actorUid, 'branding.set', 'gymPublicConfig', 'main', { nameEn, codePrefix: i.codePrefix }),
  ];
}

// ---------------------------------------------------------------- helpers for readers

export function activeBlocks(blocks: Record<string, Partial<BlockEntry>> | undefined, now: Date): string[] {
  return Object.entries(blocks ?? {})
    .filter(([, b]) => !b.until || new Date(b.until) > now)
    .map(([k]) => k);
}
