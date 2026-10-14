/**
 * Sign-in identity on the free (Spark) plan.
 *
 * Everybody except the developer signs in with an Egyptian mobile number and a password. Firebase
 * Auth only knows e-mail accounts, so each person gets an internal address that nobody sees or
 * types. The address is random (not derived from the phone), so nobody can create an account
 * with someone else's address before that person activates. The phone → address link lives in
 * `loginAliases/{aliasId}`, which can only be written while redeeming an invite.
 *
 * Invite links carry a 256-bit random code. Firestore stores only its SHA-256, so the database
 * never holds a working link.
 */

export type PersonKind = 'member' | 'staff';

/** Internal sign-in addresses use a reserved top-level domain that can never receive mail. */
export const LOGIN_EMAIL_DOMAIN = 'login.urcod.invalid';

/** `m+201001234567` for a member, `s+201001234567` for staff: the same phone can be both. */
export function aliasId(kind: PersonKind, phoneE164: string): string {
  if (!/^\+20(10|11|12|15)\d{8}$/.test(phoneE164)) throw new Error('aliasId needs a normalised Egyptian mobile');
  return (kind === 'member' ? 'm' : 's') + phoneE164;
}

const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

function randomBytes(n: number): Uint8Array {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return b;
}

/** A new, unguessable internal address, e.g. `m-3f9a…@login.urcod.invalid`. */
export function newLoginEmail(kind: PersonKind): string {
  return `${kind === 'member' ? 'm' : 's'}-${hex(randomBytes(12))}@${LOGIN_EMAIL_DOMAIN}`;
}

export function isLoginEmail(email: string): boolean {
  return new RegExp(`^[ms]-[0-9a-f]{24}@${LOGIN_EMAIL_DOMAIN.replace(/\./g, '\\.')}$`).test(email);
}

/** 32 random bytes, base64url without padding (43 characters). */
export function newInviteCode(): string {
  let s = '';
  for (const b of randomBytes(32)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function isInviteCode(code: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(code);
}

/** The Firestore document id of an invite: lowercase hex SHA-256 of the code. */
export async function inviteIdOf(code: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(code));
  return hex(new Uint8Array(digest));
}

/** The link sent on WhatsApp. The app uses hash routing, so the code sits after `#`. */
export function inviteUrl(appUrl: string, code: string): string {
  const base = appUrl.split('#')[0].replace(/\/+$/, '');
  return `${base}/#/activate?c=${code}`;
}

/** Same password rule as the activation screen: 8+ characters with a letter and a digit. */
export function passwordProblem(pw: string): null | 'short' | 'letter-digit' {
  if (pw.length < 8) return 'short';
  if (!/[A-Za-z؀-ۿ]/.test(pw) || !/\d/.test(pw)) return 'letter-digit';
  return null;
}

/** Roles each inviter may hand out. Only the developer creates admins. */
export const STAFF_ROLES = ['admin', 'accountant', 'cashier', 'coach'] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export function rolesInviterMayGrant(inviterRoles: readonly string[]): StaffRole[] {
  if (inviterRoles.includes('developer')) return [...STAFF_ROLES];
  if (inviterRoles.includes('admin')) return ['accountant', 'cashier', 'coach'];
  return [];
}
