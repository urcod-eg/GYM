/**
 * Everything the app reads from or writes to Firebase on the free (Spark) plan.
 * Writes are built by src/domain/writes.ts (the shapes the security rules accept) and committed
 * atomically. The rules decide; checks here only give a clearer message before trying.
 */
import type { Unsubscribe } from 'firebase/firestore';
import { firebase } from './client';
import { applyOps, commitOps, fromSdk } from './commit';
import * as W from '../domain/writes';
import { aliasId, inviteIdOf, inviteUrl, isInviteCode, newInviteCode, newLoginEmail, passwordProblem, type PersonKind } from '../domain/identity';
import { normalizeEgyptPhone } from '../domain/text';

/** A refusal with a reason the UI translates (`err.<reason>`). */
export class AppFailure extends Error {
  constructor(public reason: string) {
    super(reason);
  }
}
const failWith = (reason: string): never => {
  throw new AppFailure(reason);
};

const fsMod = () => import('firebase/firestore');
const authMod = () => import('firebase/auth');

export interface Actor {
  uid: string;
  roles: string[];
}

async function newId(): Promise<string> {
  const [{ db }, fs] = await Promise.all([firebase(), fsMod()]);
  return fs.doc(fs.collection(db, 'auditLogs')).id;
}

// ------------------------------------------------------------------ profile & session

export interface UserProfile {
  kind: 'member' | 'staff' | 'developer';
  roles: string[];
  status: 'active' | 'disabled' | 'replaced';
  displayName: string;
  phone: string | null;
  memberId: string | null;
}

export async function watchProfile(uid: string, cb: (p: UserProfile | null) => void): Promise<Unsubscribe> {
  const [{ db }, fs] = await Promise.all([firebase(), fsMod()]);
  return fs.onSnapshot(
    fs.doc(db, 'users', uid),
    (s) => cb(s.exists() ? (fromSdk(s.data()) as UserProfile) : null),
    () => cb(null),
  );
}

export interface MemberDoc {
  id: string;
  memberNo: number;
  memberCode: string;
  fullName: string;
  phoneE164: string;
  authUid: string | null;
  accountStatus: 'PENDING_ACTIVATION' | 'ACTIVE';
  assignedCoachId: string | null;
  blocks: Record<string, W.BlockEntry>;
  searchTokens: string[];
  createdAt: Date | null;
}

/** The signed-in member's own file. `blocked` when the rules refuse (login block or suspension). */
export async function watchOwnMember(memberId: string, cb: (m: MemberDoc | null, blocked: boolean) => void): Promise<Unsubscribe> {
  const [{ db }, fs] = await Promise.all([firebase(), fsMod()]);
  return fs.onSnapshot(
    fs.doc(db, 'members', memberId),
    (s) => cb(s.exists() ? ({ ...fromSdk<Omit<MemberDoc, 'id'>>(s.data()), id: s.id } as MemberDoc) : null, false),
    () => cb(null, true),
  );
}

// ------------------------------------------------------------------ sign-in

/** Phone + password for members and staff. Every failure looks the same to the caller. */
export async function phoneSignIn(kind: PersonKind, phoneRaw: string, password: string): Promise<UserProfile> {
  const phone = normalizeEgyptPhone(phoneRaw) ?? failWith('invalid-phone');
  const [{ auth, db }, fs, A] = await Promise.all([firebase(), fsMod(), authMod()]);
  if (auth.currentUser) await A.signOut(auth);
  const alias = await fs.getDoc(fs.doc(db, 'loginAliases', aliasId(kind, phone)));
  if (!alias.exists()) failWith('invalid-credentials');
  await A.signInWithEmailAndPassword(auth, alias.data()!.email as string, password);
  const prof = await fs.getDoc(fs.doc(db, 'users', auth.currentUser!.uid));
  const p = prof.exists() ? (fromSdk(prof.data()) as UserProfile) : null;
  const wrongKind = !p || (kind === 'staff' ? p.kind !== 'staff' : p.kind !== 'member');
  if (wrongKind || p!.status !== 'active') {
    await A.signOut(auth);
    failWith(p?.status === 'disabled' ? 'account-inactive' : 'invalid-credentials');
  }
  return p!;
}

export async function readProfile(uid: string): Promise<UserProfile | null> {
  const [{ db }, fs] = await Promise.all([firebase(), fsMod()]);
  const s = await fs.getDoc(fs.doc(db, 'users', uid));
  return s.exists() ? (fromSdk(s.data()) as UserProfile) : null;
}

// ------------------------------------------------------------------ invites

export async function openInvite(code: string): Promise<{ id: string; invite: W.InviteDoc }> {
  if (!isInviteCode(code)) failWith('link-invalid');
  const id = await inviteIdOf(code);
  const [{ db }, fs] = await Promise.all([firebase(), fsMod()]);
  const s = await fs.getDoc(fs.doc(db, 'invites', id));
  if (!s.exists()) failWith('link-invalid');
  const invite = fromSdk(s.data()) as W.InviteDoc;
  if (invite.usedBy) failWith('link-invalid');
  if (!(invite.expiresAt instanceof Date) || invite.expiresAt <= new Date()) failWith('link-expired');
  return { id, invite };
}

/**
 * Creates the invitee's new sign-in account and redeems the invite in one atomic write.
 * If the write is refused, the new account is deleted again so nothing is left half-done.
 */
export async function redeem(code: string, password: string): Promise<W.InviteDoc> {
  const problem = passwordProblem(password);
  if (problem === 'short') failWith('password-too-short');
  if (problem) failWith('password-needs-letter-and-digit');
  const { id, invite } = await openInvite(code);
  const [{ auth, db }, A] = await Promise.all([firebase(), authMod()]);
  if (auth.currentUser) await A.signOut(auth);
  const email = newLoginEmail(invite.kind);
  const cred = await A.createUserWithEmailAndPassword(auth, email, password);
  try {
    await commitOps(db, W.redeemInvite({ uid: cred.user.uid, email, inviteId: id, invite, now: new Date() }));
  } catch (e) {
    await cred.user.delete().catch(() => A.signOut(auth));
    if ((e as { code?: string }).code === 'permission-denied') failWith('link-invalid');
    throw e;
  }
  return invite;
}

async function writeInvite(build: (inviteId: string) => W.WriteOp[]): Promise<{ url: string; expiresAt: Date }> {
  const code = newInviteCode();
  const id = await inviteIdOf(code);
  const ops = build(id);
  const [{ db }] = await Promise.all([firebase()]);
  await commitOps(db, ops);
  return { url: inviteUrl(window.location.href, code), expiresAt: ops[0].data.expiresAt as Date };
}

export function createMemberInvite(actor: Actor, member: Pick<MemberDoc, 'id' | 'fullName' | 'phoneE164' | 'authUid'>, purpose: 'activate' | 'reset', identityCheck?: string) {
  return writeInvite((inviteId) => W.memberInvite({ actorUid: actor.uid, actorRoles: actor.roles, inviteId, member, purpose, identityCheck, now: new Date() }));
}

export async function createStaffInvite(actor: Actor, input: { phone: string; displayName: string; roles: string[]; purpose: 'activate' | 'reset'; target?: StaffAccount | null }) {
  const phone = normalizeEgyptPhone(input.phone) ?? failWith('invalid-phone');
  const [{ db }, fs] = await Promise.all([firebase(), fsMod()]);
  const alias = await fs.getDoc(fs.doc(db, 'loginAliases', aliasId('staff', phone)));
  const aliasOwner = alias.exists() ? (alias.data().uid as string) : null;
  return writeInvite((inviteId) =>
    W.staffInvite({ actorUid: actor.uid, actorRoles: actor.roles, inviteId, phone, displayName: input.displayName, roles: input.roles, purpose: input.purpose, target: input.target, aliasOwner, now: new Date() }),
  );
}

// ------------------------------------------------------------------ members

/**
 * Registers a member file (no membership or payment yet — those come in Phase 3).
 * `memberId` is chosen once per form, so a retry after a dropped connection cannot register twice.
 */
export async function registerMember(actor: Actor, input: { memberId: string; fullName: string; phone: string; assignedCoachId?: string | null }) {
  const phone = normalizeEgyptPhone(input.phone) ?? failWith('invalid-phone');
  const auditId = await newId();
  const [{ db }, fs] = await Promise.all([firebase(), fsMod()]);
  return fs.runTransaction(db, async (tx) => {
    const mine = await tx.get(fs.doc(db, 'members', input.memberId));
    if (mine.exists()) return { memberId: input.memberId, memberCode: mine.data().memberCode as string, existing: null as string | null };
    const [cfg, ctr, owner] = await Promise.all([tx.get(fs.doc(db, 'gymPublicConfig', 'main')), tx.get(fs.doc(db, 'counters', 'members')), tx.get(fs.doc(db, 'phoneIndex', phone))]);
    if (owner.exists()) return { memberId: '', memberCode: '', existing: owner.data().memberId as string };
    const r = W.registerMember({
      actorUid: actor.uid,
      memberId: input.memberId,
      auditId,
      fullName: input.fullName,
      phone,
      assignedCoachId: input.assignedCoachId ?? null,
      codePrefix: cfg.exists() ? (cfg.data().codePrefix as string) : null,
      counter: ctr.exists() ? { next: ctr.data().next as number } : null,
      phoneOwner: null,
    });
    applyOps(fs, db, tx, r.ops);
    return { memberId: input.memberId, memberCode: r.memberCode, existing: null };
  });
}

export async function newMemberId(): Promise<string> {
  const [{ db }, fs] = await Promise.all([firebase(), fsMod()]);
  return fs.doc(fs.collection(db, 'members')).id;
}

/** Live list of member files for the front desk (newest first). */
export async function watchMembers(cb: (rows: MemberDoc[]) => void, onError: (e: unknown) => void): Promise<Unsubscribe> {
  const [{ db }, fs] = await Promise.all([firebase(), fsMod()]);
  const q = fs.query(fs.collection(db, 'members'), fs.orderBy('memberNo', 'desc'), fs.limit(500));
  return fs.onSnapshot(q, (s) => cb(s.docs.map((d) => ({ ...fromSdk<Omit<MemberDoc, 'id'>>(d.data()), id: d.id }) as MemberDoc)), onError);
}

export async function setBlock(actor: Actor, m: MemberDoc, scope: W.BlockScope, reasonCode: string, note: string, until: Date | null) {
  const [{ db }, auditId] = await Promise.all([firebase(), newId()]);
  await commitOps(db, W.setMemberBlock({ actorUid: actor.uid, auditId, memberId: m.id, blocks: m.blocks, scope, reasonCode, note, until, now: new Date() }));
}

export async function liftBlock(actor: Actor, m: MemberDoc, scope: W.BlockScope, note: string) {
  const [{ db }, auditId] = await Promise.all([firebase(), newId()]);
  await commitOps(db, W.liftMemberBlock({ actorUid: actor.uid, auditId, memberId: m.id, blocks: m.blocks, scope, note }));
}

// ------------------------------------------------------------------ staff

export interface StaffAccount {
  uid: string;
  kind: string;
  roles: string[];
  status: 'active' | 'disabled' | 'replaced';
  displayName: string;
  phone: string;
}

export async function watchStaff(cb: (rows: StaffAccount[]) => void, onError: (e: unknown) => void): Promise<Unsubscribe> {
  const [{ db }, fs] = await Promise.all([firebase(), fsMod()]);
  const q = fs.query(fs.collection(db, 'users'), fs.where('kind', '==', 'staff'));
  return fs.onSnapshot(q, (s) => cb(s.docs.map((d) => ({ ...fromSdk<Omit<StaffAccount, 'uid'>>(d.data()), uid: d.id }) as StaffAccount).filter((x) => x.status !== 'replaced')), onError);
}

export async function updateStaffAccount(actor: Actor, target: StaffAccount, change: { roles?: string[]; status?: 'active' | 'disabled' }) {
  const [{ db }, auditId] = await Promise.all([firebase(), newId()]);
  await commitOps(db, W.updateStaff({ actorUid: actor.uid, actorRoles: actor.roles, auditId, target, ...change }));
}

// ------------------------------------------------------------------ licence & branding

export interface LicenseDoc {
  type: W.LicenseType;
  state: 'ACTIVE' | 'SUSPENDED';
  startsAt: Date;
  endsAt: Date | null;
  version: number;
  note: string;
}

export function licenseValid(l: LicenseDoc | null, now = new Date()): boolean {
  return !!l && l.state === 'ACTIVE' && (l.endsAt === null || now < l.endsAt);
}

export async function readLicense(): Promise<LicenseDoc | null> {
  const [{ db }, fs] = await Promise.all([firebase(), fsMod()]);
  const s = await fs.getDoc(fs.doc(db, 'license', 'main'));
  return s.exists() ? (fromSdk(s.data()) as LicenseDoc) : null;
}

export async function writeLicense(actor: Actor, input: { type: W.LicenseType; state: 'ACTIVE' | 'SUSPENDED'; startsAt: Date; days: number | null; note: string }) {
  const [{ db }, auditId, prev] = await Promise.all([firebase(), newId(), readLicense()]);
  await commitOps(db, W.setLicense({ actorUid: actor.uid, auditId, prevVersion: prev?.version ?? null, ...input }));
}

export interface GymConfig {
  nameAr: string;
  nameEn: string;
  codePrefix: string;
  primaryColor: string;
  supportPhone: string;
  logoDataUrl: string | null;
}

export async function watchGymConfig(cb: (c: GymConfig | null) => void): Promise<Unsubscribe> {
  const [{ db }, fs] = await Promise.all([firebase(), fsMod()]);
  return fs.onSnapshot(
    fs.doc(db, 'gymPublicConfig', 'main'),
    (s) => cb(s.exists() ? (fromSdk(s.data()) as GymConfig) : null),
    () => cb(null),
  );
}

export async function writeBranding(actor: Actor, c: GymConfig) {
  const [{ db }, auditId] = await Promise.all([firebase(), newId()]);
  await commitOps(db, W.setBranding({ actorUid: actor.uid, auditId, ...c }));
}

/** Shrinks an uploaded logo to at most 256×256 WebP so it fits in the gym's public config. */
export async function logoToDataUrl(file: File): Promise<string> {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) failWith('invalid-logo');
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 256 / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  let url = canvas.toDataURL('image/webp', 0.9);
  if (!url.startsWith('data:image/webp')) url = canvas.toDataURL('image/png');
  if (url.length > W.LOGO_MAX_CHARS) failWith('invalid-logo');
  return url;
}

// ------------------------------------------------------------------ errors

const REASON_ALIASES: Record<string, string> = {
  'permission-denied': 'missing-permission',
  'token-used': 'link-invalid',
  'token-expired': 'link-expired',
  'auth/invalid-credential': 'invalid-credentials',
  'auth/wrong-password': 'invalid-credentials',
  'auth/user-not-found': 'invalid-credentials',
  'auth/invalid-email': 'invalid-credentials',
  'auth/user-disabled': 'account-inactive',
  'auth/too-many-requests': 'too-many-attempts',
  'auth/network-request-failed': 'network',
  'auth/invalid-verification-code': 'mfa-code',
  'auth/weak-password': 'password-too-short',
  'auth/password-does-not-meet-requirements': 'password-needs-letter-and-digit',
  unavailable: 'network',
  aborted: 'busy-retry',
  'resource-exhausted': 'quota',
};

/** The translatable reason behind any failure (our own, the rules, Firestore or Firebase Auth). */
export function reasonOf(e: unknown): string {
  if (e instanceof AppFailure || e instanceof W.WriteError) return REASON_ALIASES[e.reason] ?? e.reason;
  const code = (e as { code?: string })?.code ?? '';
  return REASON_ALIASES[code] ?? REASON_ALIASES[code.replace(/^firestore\//, '')] ?? 'unknown';
}
