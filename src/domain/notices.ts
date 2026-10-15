/**
 * In-app notices from the admin to members (free plan: no push messages, so they show the next
 * time the member opens the app — a bell with the unread count and a pop-up until "OK").
 *
 * - notices/{id}: one per notice. Everyone/active/VIP notices are public to signed-in members;
 *   a notice to chosen members is not (public: false) and reaches each of them as
 *   inbox/{noticeId}_{memberId}, readable by that member only.
 * - noticeReads/{noticeId}_{memberId}: written by the member on "OK" — the admin counts them.
 */
import { audit, refuse, SERVER_TIME, type WriteOp } from './writes';

export const NOTICE_AUDIENCES = ['ALL', 'ACTIVE', 'VIP', 'MEN', 'LADIES', 'LIST'] as const;
export type NoticeAudience = (typeof NOTICE_AUDIENCES)[number];
export const NOTICE_MAX_RECIPIENTS = 200;
/** Inbox copies per write: each one is checked by the rules, which allow ~1000 expressions per request. */
export const INBOX_CHUNK = 3;

export interface NoticeInput {
  title: string;
  body: string;
  audience: NoticeAudience;
  memberIds: string[]; // LIST only
}

export interface NoticeDoc {
  title: string;
  body: string;
  audience: NoticeAudience;
  public: boolean;
  recipients: number; // LIST: how many were chosen; others: 0 (counted when shown)
  status: 'PUBLISHED' | 'ARCHIVED';
  by: string;
  at: Date | null;
  updatedAt: Date | null;
}

const clean = (s: string, max: number) => s.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);

export function cleanNotice(i: NoticeInput): NoticeInput {
  const ids = [...new Set(i.memberIds.filter((x) => /^[A-Za-z0-9_-]{1,64}$/.test(x)))];
  return { title: clean(i.title, 60), body: clean(i.body, 500), audience: i.audience, memberIds: i.audience === 'LIST' ? ids : [] };
}

/** The notice + its audit entry, then (chosen members only) one inbox copy per member, in small writes. */
export function sendNotice(i: { actorUid: string; auditId: string; noticeId: string; input: NoticeInput }): { first: WriteOp[]; rest: WriteOp[][] } {
  const n = cleanNotice(i.input);
  if (!/^[A-Za-z0-9_-]{2,40}$/.test(i.noticeId)) refuse('invalid-input');
  if (n.title.length < 2 || n.body.length < 1) refuse('invalid-input');
  if (!(NOTICE_AUDIENCES as readonly string[]).includes(n.audience)) refuse('invalid-input');
  if (n.audience === 'LIST' && (n.memberIds.length < 1 || n.memberIds.length > NOTICE_MAX_RECIPIENTS)) refuse('invalid-input');
  const first: WriteOp[] = [
    {
      type: 'set',
      path: `notices/${i.noticeId}`,
      data: { title: n.title, body: n.body, audience: n.audience, public: n.audience !== 'LIST', recipients: n.memberIds.length, status: 'PUBLISHED', by: i.actorUid, at: SERVER_TIME, updatedAt: SERVER_TIME, lastAuditId: i.auditId },
    },
    audit(i.auditId, i.actorUid, 'notice.send', 'notices', i.noticeId, { title: n.title, audience: n.audience, recipients: n.memberIds.length }),
  ];
  const copies: WriteOp[] = n.memberIds.map((m) => ({
    type: 'set',
    path: `inbox/${i.noticeId}_${m}`,
    data: { noticeId: i.noticeId, memberId: m, title: n.title, body: n.body, by: i.actorUid, at: SERVER_TIME },
  }));
  const rest: WriteOp[][] = [];
  for (let k = 0; k < copies.length; k += INBOX_CHUNK) rest.push(copies.slice(k, k + INBOX_CHUNK));
  return { first, rest };
}

/** Archive: members stop seeing it (the reads stay counted). */
export function archiveNotice(i: { actorUid: string; auditId: string; noticeId: string }): WriteOp[] {
  return [
    { type: 'update', path: `notices/${i.noticeId}`, data: { status: 'ARCHIVED', updatedAt: SERVER_TIME, lastAuditId: i.auditId } },
    audit(i.auditId, i.actorUid, 'notice.archive', 'notices', i.noticeId, {}),
  ];
}

/** The member pressed "OK". */
export function readNotice(i: { noticeId: string; memberId: string }): WriteOp[] {
  return [{ type: 'set', path: `noticeReads/${i.noticeId}_${i.memberId}`, data: { noticeId: i.noticeId, memberId: i.memberId, at: SERVER_TIME } }];
}

/** Which public notices a member should see (chosen-member ones come from their inbox). */
export function noticeForMember(a: NoticeAudience, m: { active: boolean; vip: boolean; gender?: 'M' | 'F' | null }): boolean {
  return a === 'ALL' || (a === 'ACTIVE' && m.active) || (a === 'VIP' && m.vip) || (a === 'MEN' && m.gender === 'M') || (a === 'LADIES' && m.gender === 'F');
}
