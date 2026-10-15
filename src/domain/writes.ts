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
export type DeleteOp = { type: 'delete'; path: string };
export type AnyOp = WriteOp | DeleteOp;

/** A refusal the UI can translate (`err.<reason>` in the string tables). */
export class WriteError extends Error {
  constructor(public reason: string) {
    super(reason);
  }
}
export const refuse = (reason: string): never => {
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

export type AuditEntity = 'members' | 'users' | 'license' | 'gymPublicConfig' | 'pinSecrets' | 'wipes' | 'plans' | 'gymSettings' | 'memberships' | 'banners' | 'vipTiers' | 'financeEntries' | 'cashCloses' | 'exercises';
export function audit(auditId: string, actorUid: string, action: string, entityType: AuditEntity, entityId: string, summary: DocData): WriteOp {
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

export interface StaffTarget {
  uid: string;
  roles: string[];
  status: string;
  kind: string;
  phone?: string;
}

/** Who may manage this staff account: never yourself; admins only non-admins; the developer anyone. */
function assertManageable(actorUid: string, actorRoles: readonly string[], t: StaffTarget) {
  if (t.uid === actorUid) refuse('cannot-change-self');
  if (t.kind !== 'staff' || t.status === 'replaced' || t.status === 'removed') refuse('not-found');
  const allowed = rolesInviterMayGrant(actorRoles);
  if (!t.roles.every((r) => allowed.includes(r as StaffRole))) refuse('permission-denied');
  return allowed;
}

export function updateStaff(i: { actorUid: string; actorRoles: readonly string[]; auditId: string; target: StaffTarget; roles?: string[]; status?: 'active' | 'disabled'; displayName?: string }): WriteOp[] {
  const allowed = assertManageable(i.actorUid, i.actorRoles, i.target);
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
  if (i.displayName !== undefined) {
    const name = cleanName(i.displayName);
    if (name.length < 2 || name.length > 80) refuse('invalid-name');
    data.displayName = name;
    summary.displayName = name;
  }
  if (!i.roles && !i.status && i.displayName === undefined) refuse('invalid-input');
  return [{ type: 'update', path: `users/${i.target.uid}`, data }, audit(i.auditId, i.actorUid, 'staff.update', 'users', i.target.uid, summary)];
}

/** Removes a staff account for good: no sign-in, the phone number becomes free, any open session ends. */
export function removeStaff(i: { actorUid: string; actorRoles: readonly string[]; auditId: string; target: StaffTarget & { phone: string } }): AnyOp[] {
  assertManageable(i.actorUid, i.actorRoles, i.target);
  return [
    { type: 'update', path: `users/${i.target.uid}`, data: { status: 'removed', updatedAt: SERVER_TIME, lastAuditId: i.auditId } },
    audit(i.auditId, i.actorUid, 'staff.remove', 'users', i.target.uid, { phone: i.target.phone }),
    { type: 'delete', path: `loginAliases/${aliasId('staff', i.target.phone)}` },
    { type: 'delete', path: `staffSessions/${i.target.uid}` },
  ];
}

// ---------------------------------------------------------------- staff sign-in code (4-digit PIN)

export const PIN_MAX_TRIES = 5;
export const isPin = (pin: string) => /^[0-9]{4}$/.test(pin);
export const PHRASE_MIN = 10;
export const PHRASE_MAX = 128;
/** The developer's second step is the 4-digit code plus a security phrase, checked as one value. */
export const devSecretValue = (pin: string, phrase: string) => `${pin}:${phrase}`;
export const isDevSecretValue = (v: string) => /^[0-9]{4}:.{10,128}$/su.test(v) && v.length <= 140;

/**
 * Sets a staff member's 4-digit sign-in code. Only `salt` and `hash` = SHA-256(salt + pin) are stored,
 * in a document no browser can read; the rules recompute the hash when the code is entered.
 */
export function setStaffPin(i: { actorUid: string; actorRoles: readonly string[]; auditId: string; target: StaffTarget; salt: string; hash: string }): AnyOp[] {
  assertManageable(i.actorUid, i.actorRoles, i.target);
  if (!/^[0-9a-f]{32}$/.test(i.salt) || !/^[0-9a-f]{64}$/.test(i.hash)) refuse('invalid-input');
  return [
    { type: 'set', path: `pinSecrets/${i.target.uid}`, data: { salt: i.salt, hash: i.hash, setBy: i.actorUid, setAt: SERVER_TIME, lastAuditId: i.auditId } },
    audit(i.auditId, i.actorUid, 'staff.pin', 'pinSecrets', i.target.uid, {}),
    // A new code also clears a lockout and ends any open session.
    { type: 'set', path: `pinTries/${i.target.uid}`, data: { pin: null, count: 0, authTime: 0, at: SERVER_TIME } },
    { type: 'delete', path: `staffSessions/${i.target.uid}` },
  ];
}

/** Step 1 of entering the code: record the attempt (counted, at most PIN_MAX_TRIES in a row). */
export function pinAttempt(i: { uid: string; pin: string; authTime: number; prevCount: number }): WriteOp[] {
  if (!isPin(i.pin) && !isDevSecretValue(i.pin)) refuse('invalid-pin');
  if (i.prevCount >= PIN_MAX_TRIES) refuse('pin-locked');
  return [{ type: 'set', path: `pinTries/${i.uid}`, data: { pin: i.pin, count: i.prevCount + 1, authTime: i.authTime, at: SERVER_TIME } }];
}

/**
 * The developer sets (or, from an open session, changes) their own code + security phrase.
 * `hash` = SHA-256(salt + devSecretValue(pin, phrase)).
 */
export function setDevSecret(i: { uid: string; auditId: string; salt: string; hash: string }): WriteOp[] {
  if (!/^[0-9a-f]{32}$/.test(i.salt) || !/^[0-9a-f]{64}$/.test(i.hash)) refuse('invalid-input');
  return [
    { type: 'set', path: `pinSecrets/${i.uid}`, data: { salt: i.salt, hash: i.hash, setBy: i.uid, setAt: SERVER_TIME, lastAuditId: i.auditId } },
    audit(i.auditId, i.uid, 'dev.secret', 'pinSecrets', i.uid, {}),
    { type: 'set', path: `devSetup/${i.uid}`, data: { at: SERVER_TIME } },
  ];
}

/** Step 2: open the session for this sign-in. The rules accept it only if the recorded attempt matches the hash. */
export function openStaffSession(i: { uid: string; authTime: number; device: string }): WriteOp[] {
  return [
    { type: 'set', path: `staffSessions/${i.uid}`, data: { authTime: i.authTime, device: i.device.slice(0, 120), at: SERVER_TIME } },
    { type: 'set', path: `pinTries/${i.uid}`, data: { pin: null, count: 0, authTime: i.authTime, at: SERVER_TIME } },
  ];
}

/** Ends a staff session (the person signs out, or an admin ends it remotely). */
export function endStaffSession(uid: string): AnyOp[] {
  return [{ type: 'delete', path: `staffSessions/${uid}` }];
}

/** Admin: clears a lockout after too many wrong codes, without changing the code. */
export function unlockPin(i: { actorUid: string; actorRoles: readonly string[]; target: StaffTarget }): WriteOp[] {
  assertManageable(i.actorUid, i.actorRoles, i.target);
  return [{ type: 'set', path: `pinTries/${i.target.uid}`, data: { pin: null, count: 0, authTime: 0, at: SERVER_TIME } }];
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

// ---------------------------------------------------------------- wiping member data (developer)

/** The word typed to confirm a wipe. */
export const WIPE_WORD = 'مسح';

export interface WipeCounts {
  members: number;
  accounts: number;
  invites: number;
  memberships?: number;
  payments?: number;
}

/** The record of a wipe, written first (with its audit entry) so it is logged even if a later step stops. */
export function wipeRecord(i: { actorUid: string; auditId: string; wipeId: string; counts: WipeCounts }): WriteOp[] {
  return [
    { type: 'set', path: `wipes/${i.wipeId}`, data: { by: i.actorUid, at: SERVER_TIME, counts: { ...i.counts }, lastAuditId: i.auditId } },
    audit(i.auditId, i.actorUid, 'data.wipe', 'wipes', i.wipeId, { ...i.counts }),
  ];
}

/**
 * Every document that belongs to members: the member files, their phone index, their sign-in
 * aliases and profiles, member invites, and the member-number counter. Staff, licence, branding
 * and the audit log are never included.
 */
export function wipeDeletes(i: { members: { id: string; phoneE164: string }[]; memberUserUids: string[]; memberInviteIds: string[]; membershipIds?: string[]; paymentIds?: string[]; extraPaths?: string[] }): DeleteOp[] {
  const ops: DeleteOp[] = [];
  for (const m of i.members) {
    ops.push({ type: 'delete', path: `members/${m.id}` });
    if (/^\+20(10|11|12|15)\d{8}$/.test(m.phoneE164)) {
      ops.push({ type: 'delete', path: `phoneIndex/${m.phoneE164}` });
      ops.push({ type: 'delete', path: `loginAliases/${aliasId('member', m.phoneE164)}` });
    }
  }
  for (const u of i.memberUserUids) ops.push({ type: 'delete', path: `users/${u}` });
  for (const h of i.memberInviteIds) ops.push({ type: 'delete', path: `invites/${h}` });
  for (const id of i.membershipIds ?? []) ops.push({ type: 'delete', path: `memberships/${id}` });
  for (const id of i.paymentIds ?? []) ops.push({ type: 'delete', path: `payments/${id}` });
  // Member-owned records of later phases (check-ins, codes, workout logs…), by full path.
  for (const p of i.extraPaths ?? []) ops.push({ type: 'delete', path: p });
  ops.push({ type: 'delete', path: 'counters/members' });
  return ops;
}
